import { describe, expect, test } from "bun:test"
import { createWorkbenchActions, type WorkbenchActionPanel, type WorkbenchActionStorePort } from "./workbench-actions"
import { scopePath, spaceScope } from "./workbench-scope"

function deferred<T>() {
  let resolveValue: (value: T) => void = () => {}
  let rejectValue: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve
    rejectValue = reject
  })
  return { promise, resolve: resolveValue, reject: rejectValue }
}

function createStorePort(options?: { withPty?: boolean }) {
  let panel: WorkbenchActionPanel = {
    id: "panel-space-a",
    slotState: "bound",
    boundSessionId: "session-old",
    directory: "/fixtures/workspaces/space-a",
    tuiPtyId: options?.withPty === false ? undefined : "pty-existing",
  }
  const commits: string[] = []
  const ptys: Array<string | undefined> = []
  const store: WorkbenchActionStorePort = {
    panel: (_scope, panelID) => (panel.id === panelID ? panel : undefined),
    panels: () => [panel],
    boundPanels: (sessionID) => panel.boundSessionId === sessionID ? [{ scope, panelID: panel.id, panel }] : [],
    active: () => ({ scope, panelID: panel.id }),
    addPanel: () => undefined,
    setActivePanel: () => {},
    removePanel: () => false,
    removeSpace: () => false,
    commitSessionBinding: (_scope, panelID, session) => {
      commits.push(session.id)
      panel = {
        ...panel,
        id: panelID,
        slotState: "bound",
        boundSessionId: session.id,
        directory: session.directory,
        tuiPtyId: undefined,
      }
    },
    commitSessionUnbinding: () => {
      if (panel.slotState === "empty") return false
      panel = {
        ...panel,
        slotState: "empty",
        boundSessionId: undefined,
        tuiPtyId: undefined,
        termPtyId: undefined,
        splitPtyId: undefined,
      }
      return true
    },
    commitPanelPty: (_scope, _panelID, kind, ptyID) => {
      ptys.push(ptyID)
      panel = {
        ...panel,
        tuiPtyId: kind === "tui" ? ptyID : panel.tuiPtyId,
        termPtyId: kind === "term" ? ptyID : panel.termPtyId,
        splitPtyId: kind === "split" ? ptyID : panel.splitPtyId,
      }
    },
    commitPanelMode: (_scope, _panelID, mode) => { panel = { ...panel, viewMode: mode } },
    commitSplitTerminal: (_scope, _panelID, splitTerminal) => { panel = { ...panel, splitTerminal } },
  }
  return { store, commits, ptys, panel: () => panel }
}

const scope = spaceScope("Space A", "/fixtures/workspaces/space-a")
const nextSession = {
  id: "session-next",
  title: "Next",
  directory: "/fixtures/workspaces/space-a/project-next",
  type: "chat" as const,
}

const unusedSessionPort = {
  create: async () => nextSession,
  get: async () => nextSession,
  project: () => {},
  rename: async () => {},
  remove: async () => {},
}

describe("WorkbenchActions", () => {
  test("creates a General session through an explicit scope and commits it", async () => {
    const state = createStorePort()
    const scopes: string[] = []
    const actions = createWorkbenchActions({
      store: state.store,
      pty: {
        disposePanel: async () => {},
        ensure: async ({ create }) => create(),
        disposePty: async () => {},
      },
      session: {
        create: async ({ scope: requestedScope }) => {
          scopes.push(requestedScope.kind)
          return { ...nextSession, id: "session-general", directory: "" }
        },
        get: async () => nextSession,
        project: () => {},
        rename: async () => {},
        remove: async () => {},
      },
    })

    expect(await actions.createSession({ scope: { kind: "general" }, panelID: state.panel().id })).toEqual({
      status: "committed",
      panelID: "panel-space-a",
    })
    expect(scopes).toEqual(["general"])
    expect(state.commits).toEqual(["session-general"])
  })

  test("removes a newly-created Session when its generation becomes stale", async () => {
    const state = createStorePort()
    const created = deferred<typeof nextSession>()
    const removed: string[] = []
    const actions = createWorkbenchActions({
      store: state.store,
      pty: {
        disposePanel: async () => {},
        ensure: async ({ create }) => create(),
        disposePty: async () => {},
      },
      session: {
        create: () => created.promise,
        get: async () => nextSession,
        project: () => {},
        rename: async () => {},
        remove: async ({ session }) => { removed.push(session.id) },
      },
    })

    const pending = actions.createSession({ scope, panelID: state.panel().id })
    actions.cancelPanel(scope, state.panel().id)
    created.resolve(nextSession)

    expect(await pending).toEqual({ status: "stale", panelID: "panel-space-a" })
    expect(removed).toEqual(["session-next"])
    expect(state.commits).toEqual([])
  })

  test("does not project a Session response that arrives after its Panel is cancelled", async () => {
    const state = createStorePort()
    const fetched = deferred<typeof nextSession>()
    const projected: string[] = []
    const actions = createWorkbenchActions({
      store: state.store,
      pty: {
        disposePanel: async () => {},
        ensure: async ({ create }) => create(),
        disposePty: async () => {},
      },
      session: {
        ...unusedSessionPort,
        get: () => fetched.promise,
        project: ({ session }) => { projected.push(session.id) },
      },
    })

    const pending = actions.loadSessionIntoPanel({
      scope,
      panelID: state.panel().id,
      sessionID: nextSession.id,
      directory: nextSession.directory,
    })
    actions.cancelPanel(scope, state.panel().id)
    fetched.resolve(nextSession)

    expect(await pending).toEqual({ status: "stale", panelID: "panel-space-a" })
    expect(projected).toEqual([])
    expect(state.commits).toEqual([])
  })

  test("disposes resources before committing a replacement once", async () => {
    const state = createStorePort()
    const disposed: string[] = []
    const actions = createWorkbenchActions({
      store: state.store,
      pty: {
        disposePanel: async ({ panel }) => { disposed.push(panel.id) },
        ensure: async ({ create }) => create(),
        disposePty: async () => {},
      },
      session: unusedSessionPort,
    })

    expect(await actions.replaceSession({ scope, panelID: state.panel().id, session: nextSession })).toEqual({
      status: "committed",
      panelID: "panel-space-a",
    })
    expect(disposed).toEqual(["panel-space-a"])
    expect(state.commits).toEqual(["session-next"])
  })

  test("disposes the last bound panel before turning it into an empty slot", async () => {
    const state = createStorePort()
    const events: string[] = []
    const originalUnbind = state.store.commitSessionUnbinding
    state.store.commitSessionUnbinding = (requestedScope, panelID) => {
      events.push(`unbind:${panelID}`)
      return originalUnbind(requestedScope, panelID)
    }
    const actions = createWorkbenchActions({
      store: state.store,
      pty: {
        disposePanel: async ({ panel }) => { events.push(`dispose:${panel.id}`) },
        ensure: async ({ create }) => create(),
        disposePty: async () => {},
      },
      session: unusedSessionPort,
    })

    expect(await actions.closePanel({ scope, panelID: state.panel().id })).toEqual({
      status: "committed",
      panelID: "panel-space-a",
    })
    expect(events).toEqual(["dispose:panel-space-a", "unbind:panel-space-a"])
    expect(state.panel().slotState).toBe("empty")
    expect(await actions.closePanel({ scope, panelID: state.panel().id })).toEqual({
      status: "unchanged",
      panelID: "panel-space-a",
    })
  })

  test("disposes a removable panel before deleting its layout entry", async () => {
    const panels: WorkbenchActionPanel[] = [
      {
        id: "panel-a",
        slotState: "bound",
        boundSessionId: "session-a",
        directory: scopePath(scope),
      },
      { id: "panel-b", slotState: "empty", directory: scopePath(scope) },
    ]
    const events: string[] = []
    const store: WorkbenchActionStorePort = {
      panel: (_scope, panelID) => panels.find((panel) => panel.id === panelID),
      panels: () => panels,
      boundPanels: () => [],
      active: () => ({ scope, panelID: "panel-a" }),
      addPanel: () => undefined,
      setActivePanel: () => {},
      removePanel: (_scope, panelID) => {
        events.push(`remove:${panelID}`)
        const index = panels.findIndex((panel) => panel.id === panelID)
        if (index === -1) return false
        panels.splice(index, 1)
        return true
      },
      removeSpace: () => false,
      commitSessionBinding: () => {},
      commitSessionUnbinding: () => false,
      commitPanelPty: () => {},
    }
    const actions = createWorkbenchActions({
      store,
      pty: {
        disposePanel: async ({ panel }) => { events.push(`dispose:${panel.id}`) },
        ensure: async ({ create }) => create(),
        disposePty: async () => {},
      },
      session: unusedSessionPort,
    })

    expect(await actions.closePanel({ scope, panelID: "panel-a" })).toEqual({
      status: "committed",
      panelID: "panel-a",
    })
    expect(events).toEqual(["dispose:panel-a", "remove:panel-a"])
    expect(panels.map((panel) => panel.id)).toEqual(["panel-b"])
  })

  test("disposes every panel before removing a Space and keeps General immutable", async () => {
    const panels: WorkbenchActionPanel[] = [
      { id: "panel-a", slotState: "bound", directory: scopePath(scope) },
      { id: "panel-b", slotState: "bound", directory: scopePath(scope) },
    ]
    const events: string[] = []
    let removed = false
    const store: WorkbenchActionStorePort = {
      panel: (_scope, panelID) => panels.find((panel) => panel.id === panelID),
      panels: (requestedScope) => requestedScope.kind === "general" || removed ? [] : panels,
      boundPanels: () => [],
      active: () => ({ scope, panelID: "panel-a" }),
      addPanel: () => undefined,
      setActivePanel: () => {},
      removePanel: () => false,
      removeSpace: () => {
        events.push("remove-space")
        removed = true
        return true
      },
      commitSessionBinding: () => {},
      commitSessionUnbinding: () => false,
      commitPanelPty: () => {},
    }
    const actions = createWorkbenchActions({
      store,
      pty: {
        disposePanel: async ({ panel }) => { events.push(`dispose:${panel.id}`) },
        ensure: async ({ create }) => create(),
        disposePty: async () => {},
      },
      session: unusedSessionPort,
    })

    expect(await actions.closeSpace(scope)).toEqual({ status: "committed" })
    expect(events).toEqual(["dispose:panel-a", "dispose:panel-b", "remove-space"])
    expect(await actions.closeSpace(scope)).toEqual({ status: "unchanged" })
    expect(await actions.closeSpace({ kind: "general" })).toEqual({ status: "unchanged" })
  })

  test("does not commit when resource disposal fails", async () => {
    const state = createStorePort()
    const actions = createWorkbenchActions({
      store: state.store,
      pty: {
        disposePanel: async () => { throw new Error("dispose failed") },
        ensure: async ({ create }) => create(),
        disposePty: async () => {},
      },
      session: unusedSessionPort,
    })

    expect(actions.replaceSession({ scope, panelID: state.panel().id, session: nextSession })).rejects.toThrow(
      "dispose failed",
    )
    expect(state.commits).toEqual([])
  })

  test("treats a repeated binding as an idempotent no-op", async () => {
    const state = createStorePort()
    state.store.commitSessionBinding(scope, state.panel().id, nextSession)
    state.commits.length = 0
    let disposals = 0
    const actions = createWorkbenchActions({
      store: state.store,
      pty: {
        disposePanel: async () => { disposals += 1 },
        ensure: async ({ create }) => create(),
        disposePty: async () => {},
      },
      session: unusedSessionPort,
    })

    expect(await actions.replaceSession({ scope, panelID: state.panel().id, session: nextSession })).toEqual({
      status: "unchanged",
      panelID: "panel-space-a",
    })
    expect(disposals).toBe(0)
    expect(state.commits).toEqual([])
  })

  test("ignores an older replacement that finishes after a newer generation", async () => {
    const state = createStorePort()
    const firstDisposal = deferred<void>()
    let disposalCount = 0
    const actions = createWorkbenchActions({
      store: state.store,
      pty: {
        disposePanel: () => {
          disposalCount += 1
          return disposalCount === 1 ? firstDisposal.promise : Promise.resolve()
        },
        ensure: async ({ create }) => create(),
        disposePty: async () => {},
      },
      session: unusedSessionPort,
    })

    const first = actions.replaceSession({ scope, panelID: state.panel().id, session: nextSession })
    const second = actions.replaceSession({
      scope,
      panelID: state.panel().id,
      session: { ...nextSession, id: "session-latest" },
    })

    expect(await second).toEqual({ status: "committed", panelID: "panel-space-a" })
    firstDisposal.resolve()
    expect(await first).toEqual({ status: "stale", panelID: "panel-space-a" })
    expect(state.commits).toEqual(["session-latest"])
  })

  test("disposes a PTY that arrives after its panel generation is cancelled", async () => {
    const state = createStorePort({ withPty: false })
    const created = deferred<string>()
    const disposed: string[] = []
    const actions = createWorkbenchActions({
      store: state.store,
      pty: {
        disposePanel: async () => {},
        ensure: () => created.promise,
        disposePty: async ({ knownPtyID }) => { disposed.push(knownPtyID) },
      },
      session: unusedSessionPort,
    })

    const pending = actions.ensurePanelPty({
      scope,
      panelID: state.panel().id,
      kind: "tui",
      create: async () => "unused",
    })
    actions.cancelPanel(scope, state.panel().id)
    created.resolve("pty-late")

    expect(await pending).toEqual({ status: "stale", panelID: "panel-space-a" })
    expect(disposed).toEqual(["pty-late"])
    expect(state.ptys).toEqual([])
  })

  test("keeps a live PTY after a terminal transport disconnect", async () => {
    const state = createStorePort()
    const forgotten: string[] = []
    const actions = createWorkbenchActions({
      store: state.store,
      pty: {
        disposePanel: async () => {},
        ensure: async ({ create }) => create(),
        disposePty: async () => {},
        isAlive: async () => true,
        forgetPty: ({ kind }) => { forgotten.push(kind) },
      },
      session: unusedSessionPort,
    })

    expect(await actions.recoverPanelPty({
      scope,
      panelID: state.panel().id,
      kind: "tui",
      ptyID: "pty-existing",
    })).toEqual({ status: "unchanged", panelID: "panel-space-a" })
    expect(forgotten).toEqual([])
    expect(state.panel().tuiPtyId).toBe("pty-existing")
  })

  test("clears an exited split PTY and its layout through one Action", async () => {
    const state = createStorePort()
    state.store.commitPanelPty(scope, state.panel().id, "split", "pty-split")
    state.store.commitSplitTerminal?.(scope, state.panel().id, true)
    const forgotten: string[] = []
    const actions = createWorkbenchActions({
      store: state.store,
      pty: {
        disposePanel: async () => {},
        ensure: async ({ create }) => create(),
        disposePty: async () => {},
        isAlive: async () => false,
        forgetPty: ({ kind }) => { forgotten.push(kind) },
      },
      session: unusedSessionPort,
    })

    expect(await actions.recoverPanelPty({
      scope,
      panelID: state.panel().id,
      kind: "split",
      ptyID: "pty-split",
    })).toEqual({ status: "committed", panelID: "panel-space-a" })
    expect(forgotten).toEqual(["split"])
    expect(state.panel().splitPtyId).toBeUndefined()
    expect(state.panel().splitTerminal).toBeFalse()
  })
})
