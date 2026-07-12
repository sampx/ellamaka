import type { PanelSlotState } from "../view-store"

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
  if (input.targetSlotState !== "empty") return "target-occupied" as const
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
  return input.type === "session.deleted" || (input.type === "session.updated" && typeof input.timeArchived === "number")
}

export function shouldSyncSessionTitle(input: {
  type?: string
  sessionId?: string
  title?: string
  localTitle?: string
}) {
  if (input.type !== "session.updated") return false
  if (!input.sessionId || !input.title) return false
  if (input.localTitle === undefined) return false
  return input.title !== input.localTitle
}

export function workbenchSessionEvent(input?: {
  type?: string
  properties?: {
    sessionID?: string
    info?: { id?: string; title?: string; time?: { archived?: number } }
  }
}) {
  const info = input?.properties?.info
  return {
    type: input?.type,
    sessionId: input?.properties?.sessionID ?? info?.id,
    title: info?.title,
    timeArchived: info?.time?.archived,
  }
}
