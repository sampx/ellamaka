import { describe, expect, test } from "bun:test"
import {
  createWorkbenchActions,
  type ActiveWorkbenchTarget,
  type WorkbenchActionPanel,
  type WorkbenchActionStorePort,
} from "./workbench-actions"
import { scopeKey, spaceScope, type SpaceScope } from "./workbench-scope"

const general: SpaceScope = { kind: "general" }
const spaceA = spaceScope("Space A", "/fixtures/workspaces/space-a")

function createHarness() {
  let active: ActiveWorkbenchTarget = { scope: general, panelID: "panel-general" }
  const panels = new Map<string, WorkbenchActionPanel>([
    [`${scopeKey(general)}\npanel-general`, { id: "panel-general", slotState: "bound" as const, directory: "", mode: "", width: 1 }],
    [`${scopeKey(spaceA)}\npanel-space-a`, {
      id: "panel-space-a",
      slotState: "bound" as const,
      directory: "/fixtures/workspaces/space-a",
      mode: "",
      width: 1,
    }],
  ])
  const bindings: { scope: SpaceScope; panelID: string; sessionID: string }[] = []
  const activations: ActiveWorkbenchTarget[] = []
  const store: WorkbenchActionStorePort = {
    panel: (scope, panelID) => panels.get(`${scopeKey(scope)}\n${panelID}`),
    panels: (scope) => [...panels.entries()]
      .filter(([key]) => key.startsWith(`${scopeKey(scope)}\n`))
      .map(([, panel]) => panel),
    boundPanels: () => [],
    active: () => active,
    addPanel: (scope) => {
      const panelID = scope.kind === "general" ? "panel-general-fork" : "panel-space-a-fork"
      panels.set(`${scopeKey(scope)}\n${panelID}`, { id: panelID, slotState: "empty", directory: scope.kind === "general" ? "" : scope.path, mode: "", width: 1 })
      return panelID
    },
    setActivePanel: (scope, panelID) => {
      active = { scope, panelID }
      activations.push(active)
    },
    removePanel: () => false,
    removeSpace: () => false,
    commitSessionBinding: (scope, panelID, session) => {
      bindings.push({ scope, panelID, sessionID: session.id })
    },
    commitSessionUnbinding: () => false,
    commitPanelPty: () => {},
  }
  const actions = createWorkbenchActions({
    store,
    pty: {
      disposePanel: async () => {},
      ensure: async ({ create }) => create(),
      disposePty: async () => {},
    },
    session: {
      create: async () => ({ id: "created", title: "Created", directory: "", type: "chat" }),
      get: async ({ scope, sessionID }) => ({
        id: sessionID,
        title: "Forked",
        directory: scope.kind === "general" ? "" : scope.path,
        type: "chat",
      }),
      project: () => {},
      rename: async () => {},
      remove: async () => {},
    },
  })
  return {
    actions,
    activations,
    bindings,
    getActive: () => active,
    setActive(target: ActiveWorkbenchTarget) { active = target },
  }
}

describe("Workbench command adapter", () => {
  test("routes a global command to the active Panel instead of the last registered hidden Panel", () => {
    const harness = createHarness()
    const calls: string[] = []
    harness.actions.registerPanelAction(general, "panel-general", {
      id: "session.undo",
      execute: () => calls.push("general"),
    })
    harness.actions.registerPanelAction(spaceA, "panel-space-a", {
      id: "session.undo",
      execute: () => calls.push("space-a"),
    })

    harness.actions.executeActivePanelAction("session.undo")
    harness.setActive({ scope: spaceA, panelID: "panel-space-a" })
    harness.actions.executeActivePanelAction("session.undo")

    expect(calls).toEqual(["general", "space-a"])
  })

  test("binds fork results inside both General and Space scopes", async () => {
    const harness = createHarness()

    expect(await harness.actions.bindForkedSession({
      scope: general,
      sourcePanelID: "panel-general",
      sessionID: "fork-general",
    })).toEqual({ status: "committed", panelID: "panel-general-fork" })
    expect(await harness.actions.bindForkedSession({
      scope: spaceA,
      sourcePanelID: "panel-space-a",
      sessionID: "fork-space-a",
    })).toEqual({ status: "committed", panelID: "panel-space-a-fork" })

    expect(harness.bindings).toEqual([
      { scope: general, panelID: "panel-general-fork", sessionID: "fork-general" },
      { scope: spaceA, panelID: "panel-space-a-fork", sessionID: "fork-space-a" },
    ])
    expect(harness.activations).toEqual([
      { scope: general, panelID: "panel-general-fork" },
      { scope: spaceA, panelID: "panel-space-a-fork" },
    ])
    expect(harness.getActive()).toEqual({ scope: spaceA, panelID: "panel-space-a-fork" })
  })
})
