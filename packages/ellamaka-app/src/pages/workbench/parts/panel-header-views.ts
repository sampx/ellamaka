import type { PanelSlotState } from "../view"

type PanelHeaderView = {
  id: string
  label: string
  requiresSession: boolean
  availableInOpen: boolean
}

type PanelHeaderViewState = PanelHeaderView & { disabled: boolean }

export function getPanelHeaderViews(views: PanelHeaderView[], slotState: PanelSlotState): PanelHeaderViewState[] {
  if (slotState === "empty") return []

  if (slotState === "open") {
    return views.map((view) => ({
      ...view,
      disabled: !view.availableInOpen,
    }))
  }

  return views
    .filter((view) => view.requiresSession)
    .map((view) => ({
      ...view,
      disabled: false,
    }))
}
