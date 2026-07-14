import { scopeKey, type SpaceScope } from "./workbench-scope"

export type WorkbenchActionPtyKind = "tui" | "term" | "split"

export type WorkbenchActionPanel = {
  id: string
  slotState: "empty" | "bound"
  boundSessionId?: string
  directory: string
  viewMode?: string
  splitTerminal?: boolean
  tuiPtyId?: string
  termPtyId?: string
  splitPtyId?: string
}

export type WorkbenchActionSession = {
  id: string
  title: string
  directory: string
  type: "tui" | "chat"
  directoryHealth?: "healthy" | "missing" | "unavailable"
  createdAt?: number
  lastActiveAt?: number
  timeArchived?: number
}

export type WorkbenchPanelAction = {
  id: string
  disabled?: () => boolean
  execute: () => void
}

export type ActiveWorkbenchTarget = {
  scope: SpaceScope
  panelID: string
}

export type BoundWorkbenchPanel = ActiveWorkbenchTarget & {
  panel: WorkbenchActionPanel
}

export type WorkbenchActionStorePort = {
  panel: (scope: SpaceScope, panelID: string) => WorkbenchActionPanel | undefined
  panels: (scope: SpaceScope) => readonly WorkbenchActionPanel[]
  boundPanels: (sessionID: string) => readonly BoundWorkbenchPanel[]
  active: () => ActiveWorkbenchTarget | undefined
  addPanel: (scope: SpaceScope) => string | undefined
  setActivePanel: (scope: SpaceScope, panelID: string) => void
  removePanel: (scope: SpaceScope, panelID: string) => boolean
  removeSpace: (scope: SpaceScope) => boolean
  commitSessionBinding: (scope: SpaceScope, panelID: string, session: WorkbenchActionSession) => void
  commitSessionUnbinding: (scope: SpaceScope, panelID: string) => boolean
  commitPanelPty: (scope: SpaceScope, panelID: string, kind: WorkbenchActionPtyKind, ptyID?: string) => void
  commitPanelMode?: (scope: SpaceScope, panelID: string, mode: string) => void
  commitSplitTerminal?: (scope: SpaceScope, panelID: string, open: boolean) => void
}

export type WorkbenchActionPtyPort = {
  disposePanel: (input: { scope: SpaceScope; panel: WorkbenchActionPanel }) => Promise<void>
  ensure: (input: {
    scope: SpaceScope
    panel: WorkbenchActionPanel
    kind: WorkbenchActionPtyKind
    directory: string
    create: () => Promise<string>
  }) => Promise<string>
  disposePty: (input: {
    scope: SpaceScope
    panelID: string
    kind: WorkbenchActionPtyKind
    knownPtyID: string
  }) => Promise<void>
  isAlive?: (input: { directory: string; ptyID: string }) => Promise<boolean>
  forgetPty?: (input: { scope: SpaceScope; panelID: string; kind: WorkbenchActionPtyKind }) => void
}

export type WorkbenchActionSessionPort = {
  create: (input: { scope: SpaceScope; panel: WorkbenchActionPanel }) => Promise<WorkbenchActionSession>
  get: (input: { scope: SpaceScope; sessionID: string; directory: string }) => Promise<WorkbenchActionSession>
  project: (input: { scope: SpaceScope; session: WorkbenchActionSession }) => void
  rename: (input: { scope: SpaceScope; sessionID: string; directory: string; title: string }) => Promise<void>
  remove: (input: { scope: SpaceScope; session: WorkbenchActionSession }) => Promise<void>
}

export type WorkbenchActionResult = {
  status: "committed" | "unchanged" | "stale"
  panelID: string
  ptyID?: string
}

export type WorkbenchActionStatus = Pick<WorkbenchActionResult, "status">

const ptyID = (panel: WorkbenchActionPanel, kind: WorkbenchActionPtyKind) => {
  if (kind === "tui") return panel.tuiPtyId
  if (kind === "term") return panel.termPtyId
  return panel.splitPtyId
}

export function createWorkbenchActions(input: {
  store: WorkbenchActionStorePort
  pty: WorkbenchActionPtyPort
  session: WorkbenchActionSessionPort
}) {
  const generations = new Map<string, number>()
  const panelActions = new Map<string, Map<string, WorkbenchPanelAction>>()
  const panelKey = (scope: SpaceScope, panelID: string) => `${scopeKey(scope)}\n${panelID}`
  const nextGeneration = (scope: SpaceScope, panelID: string) => {
    const key = panelKey(scope, panelID)
    const generation = (generations.get(key) ?? 0) + 1
    generations.set(key, generation)
    return generation
  }
  const isCurrent = (scope: SpaceScope, panelID: string, generation: number) =>
    generations.get(panelKey(scope, panelID)) === generation

  const panelOrThrow = (scope: SpaceScope, panelID: string) => {
    const panel = input.store.panel(scope, panelID)
    if (!panel) throw new Error(`Workbench panel not found: ${panelID}`)
    return panel
  }

  const unbindPanel = async (scope: SpaceScope, panelID: string): Promise<WorkbenchActionResult> => {
    const panel = input.store.panel(scope, panelID)
    if (!panel || (panel.slotState === "empty" && !panel.boundSessionId)) {
      return { status: "unchanged", panelID }
    }
    const generation = nextGeneration(scope, panelID)
    await input.pty.disposePanel({ scope, panel })
    if (!isCurrent(scope, panelID, generation)) return { status: "stale", panelID }
    input.store.commitSessionUnbinding(scope, panelID)
    return { status: "committed", panelID }
  }

  return {
    activeTarget: input.store.active,
    addPanel(scope: SpaceScope) {
      return input.store.addPanel(scope)
    },
    registerPanelAction(scope: SpaceScope, panelID: string, action: WorkbenchPanelAction) {
      const key = panelKey(scope, panelID)
      const actions = panelActions.get(key)
      if (actions) actions.set(action.id, action)
      else panelActions.set(key, new Map([[action.id, action]]))
    },
    unregisterPanelAction(scope: SpaceScope, panelID: string, actionID: string) {
      const key = panelKey(scope, panelID)
      const actions = panelActions.get(key)
      if (!actions) return
      actions.delete(actionID)
      if (actions.size === 0) panelActions.delete(key)
    },
    canExecuteActivePanelAction(actionID: string) {
      const active = input.store.active()
      if (!active) return false
      const action = panelActions.get(panelKey(active.scope, active.panelID))?.get(actionID)
      if (!action) return false
      return action.disabled ? !action.disabled() : true
    },
    executeActivePanelAction(actionID: string) {
      const active = input.store.active()
      if (!active) return
      const action = panelActions.get(panelKey(active.scope, active.panelID))?.get(actionID)
      if (action && !action.disabled?.()) action.execute()
    },
    cancelPanel(scope: SpaceScope, panelID: string) {
      nextGeneration(scope, panelID)
    },
    async createSession(options: {
      scope: SpaceScope
      panelID: string
    }): Promise<WorkbenchActionResult> {
      const panel = panelOrThrow(options.scope, options.panelID)
      const generation = nextGeneration(options.scope, options.panelID)
      const session = await input.session.create({ scope: options.scope, panel })
      if (!isCurrent(options.scope, options.panelID, generation)) {
        await input.session.remove({ scope: options.scope, session })
        return { status: "stale", panelID: options.panelID }
      }
      try {
        input.session.project({ scope: options.scope, session })
        input.store.commitSessionBinding(options.scope, options.panelID, session)
        input.store.setActivePanel(options.scope, options.panelID)
      } catch (error) {
        await input.session.remove({ scope: options.scope, session })
        throw error
      }
      return { status: "committed", panelID: options.panelID }
    },
    async closePanel(options: {
      scope: SpaceScope
      panelID: string
    }): Promise<WorkbenchActionResult> {
      const panel = input.store.panel(options.scope, options.panelID)
      if (!panel) return { status: "unchanged", panelID: options.panelID }
      if (input.store.panels(options.scope).length <= 1) {
        return unbindPanel(options.scope, options.panelID)
      }
      const generation = nextGeneration(options.scope, options.panelID)
      await input.pty.disposePanel({ scope: options.scope, panel })
      if (!isCurrent(options.scope, options.panelID, generation)) {
        return { status: "stale", panelID: options.panelID }
      }
      input.store.removePanel(options.scope, options.panelID)
      return { status: "committed", panelID: options.panelID }
    },
    unbindSession(options: {
      scope: SpaceScope
      panelID: string
    }) {
      return unbindPanel(options.scope, options.panelID)
    },
    async unbindSessionEverywhere(sessionID: string): Promise<WorkbenchActionStatus> {
      const targets = input.store.boundPanels(sessionID)
      if (targets.length === 0) return { status: "unchanged" }
      const results = await Promise.all(targets.map((target) => unbindPanel(target.scope, target.panelID)))
      return { status: results.some((result) => result.status === "stale") ? "stale" : "committed" }
    },
    async closeSpace(scope: SpaceScope): Promise<WorkbenchActionStatus> {
      if (scope.kind === "general") return { status: "unchanged" }
      const panels = input.store.panels(scope)
      if (panels.length === 0) return { status: "unchanged" }
      const pending = panels.map((panel) => ({
        panel,
        generation: nextGeneration(scope, panel.id),
      }))
      await Promise.all(pending.map(({ panel }) => input.pty.disposePanel({ scope, panel })))
      if (pending.some(({ panel, generation }) => !isCurrent(scope, panel.id, generation))) {
        return { status: "stale" }
      }
      input.store.removeSpace(scope)
      return { status: "committed" }
    },
    async bindForkedSession(options: {
      scope: SpaceScope
      sourcePanelID: string
      sessionID: string
    }): Promise<WorkbenchActionResult> {
      const sourcePanel = panelOrThrow(options.scope, options.sourcePanelID)
      const generation = nextGeneration(options.scope, options.sourcePanelID)
      const session = await input.session.get({
        scope: options.scope,
        sessionID: options.sessionID,
        directory: sourcePanel.directory,
      })
      if (!isCurrent(options.scope, options.sourcePanelID, generation)) {
        return { status: "stale", panelID: options.sourcePanelID }
      }

      input.session.project({ scope: options.scope, session })
      const targetPanelID = input.store.addPanel(options.scope)
      if (targetPanelID) {
        input.store.commitSessionBinding(options.scope, targetPanelID, session)
        input.store.setActivePanel(options.scope, targetPanelID)
        return { status: "committed", panelID: targetPanelID }
      }
      const replaceGeneration = nextGeneration(options.scope, options.sourcePanelID)
      await input.pty.disposePanel({ scope: options.scope, panel: sourcePanel })
      if (!isCurrent(options.scope, options.sourcePanelID, replaceGeneration)) {
        return { status: "stale", panelID: options.sourcePanelID }
      }
      input.store.commitSessionBinding(options.scope, options.sourcePanelID, session)
      input.store.setActivePanel(options.scope, options.sourcePanelID)
      return { status: "committed", panelID: options.sourcePanelID }
    },
    async refreshSession(options: {
      scope: SpaceScope
      panelID: string
      sessionID: string
      directory: string
    }): Promise<WorkbenchActionResult> {
      const session = await input.session.get({
        scope: options.scope,
        sessionID: options.sessionID,
        directory: options.directory,
      })
      const panel = input.store.panel(options.scope, options.panelID)
      if (!panel || panel.boundSessionId !== options.sessionID) {
        return { status: "stale", panelID: options.panelID }
      }
      input.session.project({ scope: options.scope, session })
      return { status: "committed", panelID: options.panelID }
    },
    async loadSessionIntoPanel(options: {
      scope: SpaceScope
      panelID: string
      sessionID: string
      directory: string
    }): Promise<WorkbenchActionResult> {
      const generation = nextGeneration(options.scope, options.panelID)
      const session = await input.session.get({
        scope: options.scope,
        sessionID: options.sessionID,
        directory: options.directory,
      })
      if (!isCurrent(options.scope, options.panelID, generation)) {
        return { status: "stale", panelID: options.panelID }
      }
      const panel = panelOrThrow(options.scope, options.panelID)
      if (
        panel.slotState === "bound" &&
        panel.boundSessionId === session.id &&
        panel.directory === session.directory
      ) {
        input.session.project({ scope: options.scope, session })
        return { status: "unchanged", panelID: options.panelID }
      }
      await input.pty.disposePanel({ scope: options.scope, panel })
      if (!isCurrent(options.scope, options.panelID, generation)) {
        return { status: "stale", panelID: options.panelID }
      }
      input.session.project({ scope: options.scope, session })
      input.store.commitSessionBinding(options.scope, options.panelID, session)
      input.store.setActivePanel(options.scope, options.panelID)
      return { status: "committed", panelID: options.panelID }
    },
    renameSession(options: {
      scope: SpaceScope
      sessionID: string
      directory: string
      title: string
    }) {
      return input.session.rename(options)
    },
    async deleteSession(options: {
      scope: SpaceScope
      sessionID: string
      directory: string
    }): Promise<WorkbenchActionStatus> {
      const session = await input.session.get(options)
      await input.session.remove({ scope: options.scope, session })
      const targets = input.store.boundPanels(options.sessionID)
      if (targets.length === 0) return { status: "committed" }
      const results = await Promise.all(targets.map((target) => unbindPanel(target.scope, target.panelID)))
      return { status: results.some((result) => result.status === "stale") ? "stale" : "committed" }
    },
    async replaceSession(options: {
      scope: SpaceScope
      panelID: string
      session: WorkbenchActionSession
    }): Promise<WorkbenchActionResult> {
      const panel = panelOrThrow(options.scope, options.panelID)
      if (
        panel.slotState === "bound" &&
        panel.boundSessionId === options.session.id &&
        panel.directory === options.session.directory
      ) {
        input.session.project({ scope: options.scope, session: options.session })
        return { status: "unchanged", panelID: options.panelID }
      }

      const generation = nextGeneration(options.scope, options.panelID)
      await input.pty.disposePanel({ scope: options.scope, panel })
      if (!isCurrent(options.scope, options.panelID, generation)) {
        return { status: "stale", panelID: options.panelID }
      }
      input.session.project({ scope: options.scope, session: options.session })
      input.store.commitSessionBinding(options.scope, options.panelID, options.session)
      input.store.setActivePanel(options.scope, options.panelID)
      return { status: "committed", panelID: options.panelID }
    },
    async ensurePanelPty(options: {
      scope: SpaceScope
      panelID: string
      kind: WorkbenchActionPtyKind
      create: () => Promise<string>
    }): Promise<WorkbenchActionResult> {
      const panel = panelOrThrow(options.scope, options.panelID)
      const existingPtyID = ptyID(panel, options.kind)
      const generation = nextGeneration(options.scope, options.panelID)
      const createdPtyID = await input.pty.ensure({
        scope: options.scope,
        panel,
        kind: options.kind,
        directory: panel.directory,
        create: options.create,
      })
      if (!isCurrent(options.scope, options.panelID, generation)) {
        if (createdPtyID !== existingPtyID) {
          await input.pty.disposePty({
            scope: options.scope,
            panelID: options.panelID,
            kind: options.kind,
            knownPtyID: createdPtyID,
          })
        }
        return { status: "stale", panelID: options.panelID }
      }
      if (createdPtyID === existingPtyID) {
        return { status: "unchanged", panelID: options.panelID, ptyID: createdPtyID }
      }
      input.store.commitPanelPty(options.scope, options.panelID, options.kind, createdPtyID)
      return { status: "committed", panelID: options.panelID, ptyID: createdPtyID }
    },
    async closeSplitTerminal(options: {
      scope: SpaceScope
      panelID: string
    }): Promise<WorkbenchActionResult> {
      const panel = panelOrThrow(options.scope, options.panelID)
      const existingPtyID = ptyID(panel, "split")
      const generation = nextGeneration(options.scope, options.panelID)
      if (existingPtyID) {
        await input.pty.disposePty({
          scope: options.scope,
          panelID: options.panelID,
          kind: "split",
          knownPtyID: existingPtyID,
        })
      }
      if (!isCurrent(options.scope, options.panelID, generation)) {
        return { status: "stale", panelID: options.panelID }
      }
      input.store.commitSplitTerminal?.(options.scope, options.panelID, false)
      input.store.commitPanelPty(options.scope, options.panelID, "split", undefined)
      return { status: existingPtyID ? "committed" : "unchanged", panelID: options.panelID }
    },
    async recoverPanelPty(options: {
      scope: SpaceScope
      panelID: string
      kind: WorkbenchActionPtyKind
      ptyID: string
    }): Promise<WorkbenchActionResult> {
      const panel = input.store.panel(options.scope, options.panelID)
      if (!panel || ptyID(panel, options.kind) !== options.ptyID) {
        return { status: "stale", panelID: options.panelID }
      }
      const generation = nextGeneration(options.scope, options.panelID)
      const alive = await (input.pty.isAlive?.({ directory: panel.directory, ptyID: options.ptyID }) ?? Promise.resolve(false))
      if (!isCurrent(options.scope, options.panelID, generation)) {
        return { status: "stale", panelID: options.panelID }
      }
      if (alive) return { status: "unchanged", panelID: options.panelID }

      input.pty.forgetPty?.({ scope: options.scope, panelID: options.panelID, kind: options.kind })
      input.store.commitPanelPty(options.scope, options.panelID, options.kind, undefined)
      if (options.kind === "tui") input.store.commitPanelMode?.(options.scope, options.panelID, "chat")
      if (options.kind === "split") input.store.commitSplitTerminal?.(options.scope, options.panelID, false)
      return { status: "committed", panelID: options.panelID }
    },
  }
}
