import type { WorkbenchPanel } from "../view-store"
import type { SpaceScope } from "../workbench-scope"
import { sanitizeDirectory } from "../directory-utils"
import { reportWorkbenchError } from "../workbench-error"

export type PanelDropContext = {
  panel: WorkbenchPanel
  spaceName: string
  spacePath: string
  wb: {
    spaces: Record<string, { panels: WorkbenchPanel[]; activePanelID: string }>
    boundPanelIdForSession(sessionID: string): string | undefined
    spaceState(path: string): { panels: WorkbenchPanel[]; activePanelID: string } | undefined
  }
  actions: {
    loadSessionIntoPanel(options: {
      scope: SpaceScope
      panelID: string
      sessionID: string
      directory: string
    }): Promise<{ status: string; panelID: string }>
  }
  panelScope: () => SpaceScope
  dialog: {
    show(fn: () => unknown): Promise<void>
  }
  t: (key: string, params?: Record<string, string | number | boolean>) => string
  showToast: (opts: { title: string }) => void
}

export function handlePanelDrop(
  e: DragEvent,
  ctx: PanelDropContext,
  showOverwriteDialog: (panelIndex: number, onConfirm: () => Promise<void>) => void,
  showCrossSpaceWarning: (dragSpace: string, targetSpace: string) => void,
) {
  e.preventDefault()
  e.stopPropagation()
  const sessionId = e.dataTransfer?.getData("text/sessionId") ?? ""
  const dragSpaceName = e.dataTransfer?.getData("text/spaceName") ?? ""
  if (!sessionId || !dragSpaceName) return

  if (/[\/\\]/.test(sessionId) || sessionId === ".." || sessionId === ".") {
    console.error("Rejected drag payload with path-like sessionId:", sessionId)
    return
  }

  const spacePath = ctx.spacePath

  if (dragSpaceName !== ctx.spaceName) {
    showCrossSpaceWarning(dragSpaceName, ctx.spaceName)
    return
  }

  if (ctx.panel.boundSessionId === sessionId) return

  const rawProjectPath = e.dataTransfer?.getData("text/projectPath") || ctx.panel.directory
  const projectPath = sanitizeDirectory(rawProjectPath)
  if (projectPath === undefined) {
    console.error("Rejected drag payload with unsafe projectPath:", rawProjectPath)
    return
  }

  const sessionBoundPanelId = ctx.wb.boundPanelIdForSession(sessionId)
  const boundPanel =
    sessionBoundPanelId && sessionBoundPanelId !== ctx.panel.id
      ? ctx.wb.spaceState(spacePath)?.panels.find((panel) => panel.id === sessionBoundPanelId)
      : undefined
  const sourceHasLiveBinding = !!boundPanel && boundPanel.boundSessionId === sessionId

  if (sourceHasLiveBinding) {
    ctx.showToast({ title: ctx.t("workbench.panel.sessionAlreadyOpen") })
    return
  }

  const loadSessionIntoPanel = async () => {
    await ctx.actions.loadSessionIntoPanel({
      scope: ctx.panelScope(),
      panelID: ctx.panel.id,
      sessionID: sessionId,
      directory: projectPath || spacePath,
    })
  }

  if (ctx.panel.slotState === "bound") {
    const panelsList = ctx.wb.spaceState(spacePath)?.panels ?? []
    const idx = panelsList.findIndex((p) => p.id === ctx.panel.id)
    showOverwriteDialog(idx !== -1 ? idx + 1 : 1, () =>
      loadSessionIntoPanel().catch((error) => reportWorkbenchError("replace session", error)),
    )
  } else {
    void loadSessionIntoPanel().catch((error) => reportWorkbenchError("load session into panel", error))
  }
}

export function startSplitResize(
  e: MouseEvent,
  container: HTMLDivElement | undefined,
  currentSplitHeight: number,
  onCommit: (height: number) => void,
) {
  e.preventDefault()
  if (!container) return

  const splitTerminalEl = container.querySelector<HTMLElement>("[data-split-terminal]")
  if (!splitTerminalEl) return

  const startY = e.clientY
  const startHeight = currentSplitHeight
  const totalHeight = container.getBoundingClientRect().height

  const onMouseMove = (moveEvent: MouseEvent) => {
    const deltaY = moveEvent.clientY - startY
    let newHeight = startHeight - deltaY

    if (newHeight < 120) newHeight = 120
    const maxHeight = Math.max(120, totalHeight - 4 - 200)
    if (newHeight > maxHeight) newHeight = maxHeight

    splitTerminalEl.style.height = `${newHeight}px`
  }

  const onMouseUp = () => {
    document.removeEventListener("mousemove", onMouseMove)
    document.removeEventListener("mouseup", onMouseUp)

    const finalHeight = parseFloat(splitTerminalEl.style.height)
    if (!isNaN(finalHeight)) onCommit(finalHeight)
  }

  document.addEventListener("mousemove", onMouseMove)
  document.addEventListener("mouseup", onMouseUp)
}
