import type { PanelSlotState } from "../view"

export function shouldAcceptSessionDrop(input: {
  targetSlotState: PanelSlotState
  sourceHasLiveBinding: boolean
}) {
  return sessionDropRejection(input) === undefined
}

export function sessionDropRejection(input: {
  targetSlotState: PanelSlotState
  sourceHasLiveBinding: boolean
}) {
  if (input.targetSlotState !== "empty" && input.targetSlotState !== "open") return "target-occupied" as const
  if (input.sourceHasLiveBinding) return "session-already-open" as const
}

export function shouldRestoreBoundSession(input: {
  slotState: PanelSlotState
  boundSessionId?: string
  hasLocalSession: boolean
}) {
  return input.slotState === "bound" && !!input.boundSessionId && !input.hasLocalSession
}

export function shouldUnbindSessionFromEvent(input: {
  type?: string
  timeArchived?: number
}) {
  return input.type === "session.deleted" || (input.type === "session.updated" && input.timeArchived !== undefined)
}
