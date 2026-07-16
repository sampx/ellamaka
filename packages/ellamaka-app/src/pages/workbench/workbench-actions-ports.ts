import { ptyManager, ptyReferences } from "./pty-manager"
import { scopePath, scopeName, type SpaceScope } from "./workbench-scope"
import type {
  WorkbenchActionPtyPort,
  WorkbenchActionSessionPort,
  WorkbenchActionStorePort,
} from "./workbench-actions"

type ServerSDK = ReturnType<typeof import("@/context/server-sdk").useServerSDK>
type SessionStore = ReturnType<typeof import("./session-store").useSessionStore>
type SessionProjectionWriter = ReturnType<typeof import("./session-store").useSessionProjectionWriter>
type WorkbenchState = ReturnType<typeof import("./view-store").useWorkbenchState>

export function buildStorePort(wb: WorkbenchState): WorkbenchActionStorePort {
  return {
    panel: (scope, panelID) => wb.spaceState(scopePath(scope))?.panels.find((panel) => panel.id === panelID),
    panels: (scope) => wb.spaceState(scopePath(scope))?.panels ?? [],
    boundPanels: wb.boundPanels,
    active: wb.active,
    addPanel: (scope) => wb.addPanel(scopePath(scope)),
    setActivePanel: (scope, panelID) => wb.setActivePanel(scopePath(scope), panelID),
    setActive: (spaceName) => wb.setActive(spaceName),
    activePanelID: (scope) => wb.spaceState(scopePath(scope))?.activePanelID,
    removePanel: (scope, panelID) => wb.removePanel(scopePath(scope), panelID),
    removeSpace: (scope) => wb.removeSpace(scopePath(scope)),
    commitSessionBinding: (scope, panelID, session) => wb.bindSessionToPanel(scopePath(scope), panelID, session),
    commitSessionUnbinding: (scope, panelID) => wb.unbindSessionFromPanel(scopePath(scope), panelID),
    commitPanelPty: (scope, panelID, kind, ptyID) => wb.setPanelPtyId(scopePath(scope), panelID, kind, ptyID),
    commitPanelMode: (scope, panelID, mode) => wb.setPanelViewMode(scopePath(scope), panelID, mode),
    commitSplitTerminal: (scope, panelID, open) => wb.setPanelSplitTerminal(scopePath(scope), panelID, open),
  }
}

export function buildPtyPort(
  serverSDK: ServerSDK,
  store: WorkbenchActionStorePort,
): WorkbenchActionPtyPort {
  const sdkForDirectory = (directory: string) => ({
    client: serverSDK.createClient({ directory, throwOnError: true }),
  })

  return {
    disposePanel: ({ scope, panel }) =>
      ptyManager.disposePanel(scopePath(scope), panel.id, sdkForDirectory(panel.directory), ptyReferences(panel)),
    ensure: ({ scope, panel, kind, directory, create }) =>
      ptyManager.ensure({
        spacePath: scopePath(scope),
        panelId: panel.id,
        kind,
        existingPtyId:
          kind === "tui" ? panel.tuiPtyId : kind === "term" ? panel.termPtyId : panel.splitPtyId,
        sdk: sdkForDirectory(directory),
        directory,
        createFn: create,
      }),
    disposePty: ({ scope, panelID, kind, knownPtyID }) =>
      ptyManager.disposePty({
        spacePath: scopePath(scope),
        panelId: panelID,
        kind,
        sdk: sdkForDirectory(store.panel(scope, panelID)?.directory ?? scopePath(scope)),
        knownPtyId: knownPtyID,
      }),
    isAlive: async ({ directory, ptyID }) => {
      try {
        await serverSDK.createClient({ directory, throwOnError: true }).pty.get({ ptyID })
        return true
      } catch {
        return false
      }
    },
    forgetPty: ({ scope, panelID, kind }) => ptyManager.delete(scopePath(scope), panelID, kind),
  }
}

export function buildSessionPort(
  serverSDK: ServerSDK,
  sessions: SessionStore,
  projection: SessionProjectionWriter,
): WorkbenchActionSessionPort {
  return {
    create: async ({ scope, panel }) => {
      const client = serverSDK.createClient({ directory: panel.directory, throwOnError: true })
      const target = scope.kind === "general"
        ? { type: "general" as const }
        : { type: "space" as const, space: scope.name }
      const result = await client.workbench.createSession({ target })
      if (!result.data?.id) throw new Error("Session creation returned no session id")
      const createdAt = typeof result.data.timeCreated === "number" ? result.data.timeCreated : Date.now()
      return {
        id: result.data.id,
        title: result.data.title ?? (scope.kind === "general" ? "New chat" : `${scope.name} chat`),
        directory: result.data.directory,
        type: "chat",
        directoryHealth: result.data.directoryHealth,
        createdAt,
        lastActiveAt: typeof result.data.timeUpdated === "number" ? result.data.timeUpdated : createdAt,
      }
    },
    get: async ({ sessionID, directory }) => {
      const client = serverSDK.createClient({ directory, throwOnError: true })
      const result = await client.session.get({ sessionID })
      if (!result.data?.id) throw new Error(`Forked Session not found: ${sessionID}`)
      return {
        id: result.data.id,
        parentID: result.data.parentID,
        title: result.data.title ?? result.data.id,
        directory: result.data.directory,
        type: "chat",
        createdAt: result.data.time.created,
        lastActiveAt: result.data.time.updated ?? result.data.time.created,
        timeArchived: result.data.time.archived,
      }
    },
    project: ({ scope, session: serverSession }) => {
      const existing = sessions.getSession(serverSession.id)
      projection.upsert({
        id: serverSession.id,
        spaceName: scopeName(scope),
        projectPath: serverSession.directory,
        type: serverSession.type,
        title: serverSession.title,
        directoryHealth: serverSession.directoryHealth ?? existing?.directoryHealth ?? "healthy",
        createdAt: serverSession.createdAt ?? existing?.createdAt ?? Date.now(),
        lastActiveAt: serverSession.lastActiveAt ?? existing?.lastActiveAt ?? Date.now(),
        timeArchived: serverSession.timeArchived,
      })
    },
    rename: async ({ sessionID, directory, title }) => {
      const client = serverSDK.createClient({ directory, throwOnError: true })
      await client.session.update({ sessionID, title })
      projection.patch(sessionID, { title })
    },
    remove: async ({ session: serverSession }) => {
      const client = serverSDK.createClient({ directory: serverSession.directory, throwOnError: true })
      await client.session.delete({ sessionID: serverSession.id })
      projection.remove(serverSession.id)
    },
  }
}
