import type { WopalSpace, WorkbenchPanel, SpaceWorkbenchState } from "../workbench-store"
import { scopeFromTab, type SpaceScope } from "../workbench-scope"
import { reportWorkbenchError } from "../workbench-error"

// ── Types ───────────────────────────────────────────────────────────────────

export type GroupSession = {
  id: string
  title: string
  directory: string
  directoryHealth: "healthy" | "missing" | "unavailable"
  agent?: string
  timeCreated: number
  timeUpdated: number
}

export type SessionGroup = {
  id: string
  title: string
  type: "space" | "general"
  sessionCount: number
  sessions: GroupSession[]
}

// ── Minimal dependency interfaces (subset of full store / actions / dialog) ─

export interface OpenSessionWB {
  spaces: Record<string, SpaceWorkbenchState>
  openTab(space: WopalSpace): void
  ensureSpace(path: string): void
  setStatusMessage(message: string): void
  activeTab(): WopalSpace | undefined
  findSessionBinding(sessionID: string): { spacePath: string; panelID: string } | undefined
}

export interface OpenSessionActions {
  addPanel(scope: SpaceScope): string | undefined
  replaceSession(options: {
    scope: SpaceScope
    panelID: string
    session: { id: string; title: string; directory: string; type: string }
  }): Promise<{ status: string; panelID: string }>
}

// ── fetchSessionGroups (pure async — receives SDK client, returns groups) ──

export type SessionGroupsSDK = {
  client: {
    workbench: {
      sessionGroups: () => Promise<{
        data?: {
          groups: Array<{
            id: string
            title: string
            type: "space" | "general"
            sessionCount: number | string
            sessions?: Array<{
              id: string
              title: string
              directory: string
              directoryHealth: "healthy" | "missing" | "unavailable"
              agent?: string
              timeCreated: number | string
              timeUpdated: number | string
            }>
          }>
        }
      }>
    }
  }
}

function normalizeCount(n: number | string): number {
  return typeof n === "number" ? n : 0
}

function normalizeTimestamp(n: number | string): number {
  return typeof n === "number" ? n : 0
}

export async function fetchSessionGroups(sdk: SessionGroupsSDK): Promise<SessionGroup[]> {
  const res = await sdk.client.workbench.sessionGroups()
  const rawGroups = res.data?.groups ?? []
  return rawGroups.map((g) => ({
    id: g.id,
    title: g.title,
    type: g.type,
    sessionCount: normalizeCount(g.sessionCount),
    sessions: (g.sessions ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      directory: s.directory,
      directoryHealth: s.directoryHealth,
      agent: s.agent,
      timeCreated: normalizeTimestamp(s.timeCreated),
      timeUpdated: normalizeTimestamp(s.timeUpdated),
    })),
  }))
}

export function createSessionGroupsLoader(input: {
  fetch: () => Promise<SessionGroup[]>
  commit: (groups: SessionGroup[]) => void
  setLoading: (loading: boolean) => void
  onError: (error: unknown) => void
}) {
  let latestRequest = 0

  return async () => {
    const request = latestRequest + 1
    latestRequest = request
    input.setLoading(true)
    try {
      const groups = await input.fetch()
      if (request !== latestRequest) return
      input.commit(groups)
    } catch (error) {
      if (request === latestRequest) input.onError(error)
    } finally {
      if (request === latestRequest) input.setLoading(false)
    }
  }
}

// ── resolveTargetPanel (pure sync — panel selection decision) ───────────────

export type TargetPanelResolution =
  | { kind: "empty"; panel: WorkbenchPanel }
  | { kind: "new" }
  | { kind: "overwrite"; panel: WorkbenchPanel; index: number }

export function resolveTargetPanel(
  panels: WorkbenchPanel[],
  activePanelID: string,
  maxPanels: number,
): TargetPanelResolution {
  const emptyPanel = panels.find((p) => p.slotState === "empty")
  if (emptyPanel) return { kind: "empty", panel: emptyPanel }

  if (panels.length < maxPanels) return { kind: "new" }

  const activePanel = panels.find((p) => p.id === activePanelID)
  if (activePanel) {
    const idx = panels.findIndex((p) => p.id === activePanelID)
    return { kind: "overwrite", panel: activePanel, index: idx + 1 }
  }
  return { kind: "overwrite", panel: panels[0], index: 1 }
}

// ── getPanelBadge (pure helper) ─────────────────────────────────────────────

export function getPanelBadge(
  wb: OpenSessionWB,
  sessionId: string,
): string | undefined {
  const binding = wb.findSessionBinding(sessionId)
  if (!binding) return undefined
  const index = wb.spaces[binding.spacePath]?.panels.findIndex((panel) => panel.id === binding.panelID) ?? -1
  return index === -1 ? undefined : `P${index + 1}`
}

// ── openSessionInPanel (orchestration) ──────────────────────────────────────

export async function openSessionInPanel(params: {
  session: { id: string; title: string }
  sessionDirectory: string
  spaceName: string
  spaces: WopalSpace[]
  wb: OpenSessionWB
  actions: OpenSessionActions
  t: (key: string, params?: Record<string, string | number | boolean>) => string
  showOverwriteDialog: (panelIndex: number, onConfirm: () => Promise<void>) => void
}): Promise<void> {
  const targetSpace = params.spaces.find((s) => s.name === params.spaceName)
  if (!targetSpace) return

  const targetSpacePath = targetSpace.path
  const scope = scopeFromTab(targetSpace)

  const loadSessionIntoPanel = async (panel: WorkbenchPanel) => {
    await params.actions.replaceSession({
      scope,
      panelID: panel.id,
      session: {
        id: params.session.id,
        title: params.session.title,
        directory: params.sessionDirectory || targetSpacePath,
        type: "chat",
      },
    })
    const newBadge = getPanelBadge(params.wb, params.session.id)
    params.wb.setStatusMessage(
      params.t("workbench.status.sessionLoaded", { badge: newBadge ?? "" }),
    )
  }

  params.wb.openTab(targetSpace)
  params.wb.ensureSpace(targetSpacePath)

  const space = params.wb.spaces[targetSpacePath]
  if (!space || space.panels.length === 0) return

  const resolution = resolveTargetPanel(space.panels, space.activePanelID, 3)

  if (resolution.kind === "empty") {
    await loadSessionIntoPanel(resolution.panel).catch((error) =>
      reportWorkbenchError("load session into panel", error),
    )
  } else if (resolution.kind === "new") {
    const newPanelId = params.actions.addPanel(scope)
    if (newPanelId) {
      const updatedSpace = params.wb.spaces[targetSpacePath]
      const newPanel = updatedSpace?.panels?.find((p) => p.id === newPanelId)
      if (newPanel) {
        await loadSessionIntoPanel(newPanel).catch((error) =>
          reportWorkbenchError("load session into panel", error),
        )
      }
    }
  } else {
    params.showOverwriteDialog(resolution.index, () =>
      loadSessionIntoPanel(resolution.panel),
    )
  }
}
