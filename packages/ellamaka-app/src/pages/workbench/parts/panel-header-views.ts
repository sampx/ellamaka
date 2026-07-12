import type { PanelSlotState } from "../view-store"

type PanelHeaderView = {
  id: string
  label: string
  requiresSession: boolean
}

type PanelHeaderViewState = PanelHeaderView & {
  disabled: boolean
  hasOpenTui: boolean
}

export function getPanelHeaderViews(views: PanelHeaderView[], slotState: PanelSlotState, tuiPtyId?: string): PanelHeaderViewState[] {
  if (slotState === "empty") return []

  return views
    .filter((view) => view.requiresSession)
    .map((view) => ({
      ...view,
      disabled: false,
      hasOpenTui: view.id === "tui" && !!tuiPtyId,
    }))
}
