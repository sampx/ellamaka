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

  const seen = new Set<string>()
  const uniqueViews: PanelHeaderView[] = []

  for (const view of views) {
    if (!view.requiresSession) continue
    if (seen.has(view.id)) continue
    seen.add(view.id)
    uniqueViews.push(view)
  }

  return uniqueViews.map((view) => ({
    ...view,
    disabled: false,
    hasOpenTui: view.id === "tui" && !!tuiPtyId,
  }))
}
