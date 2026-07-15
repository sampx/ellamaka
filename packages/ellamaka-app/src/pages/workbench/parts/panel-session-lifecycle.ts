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
  return undefined
}

export function shouldRestoreBoundSession(input: {
  slotState: PanelSlotState
  boundSessionId?: string
  hasLocalSession: boolean
}) {
  return input.slotState === "bound" && !!input.boundSessionId && !input.hasLocalSession
}

export type SessionRemovalReason = "deleted" | "archived"

export function sessionRemovalReasonFromEvent(input: {
  type?: string
  timeArchived?: number
}): SessionRemovalReason | undefined {
  if (input.type === "session.deleted") return "deleted"
  if (input.type === "session.updated" && typeof input.timeArchived === "number") return "archived"
  return undefined
}

export function shouldNotifySessionRemoval(input: {
  affectedPanelCount: number
  isBound: boolean
}) {
  return input.affectedPanelCount > 0 && !input.isBound
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

export type DisconnectRecovery = "reconnect" | "fallback"

export function disconnectRecovery(input: { ptyAlive: boolean }): DisconnectRecovery {
  return input.ptyAlive ? "reconnect" : "fallback"
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function workbenchSessionEvent(input?: unknown) {
  const properties = record(input) && record(input.properties) ? input.properties : undefined
  const info = record(properties?.info) ? properties.info : undefined
  const time = record(info?.time) ? info.time : undefined
  return {
    type: record(input) && typeof input.type === "string" ? input.type : undefined,
    sessionId:
      (typeof properties?.sessionID === "string" ? properties.sessionID : undefined) ??
      (typeof info?.id === "string" ? info.id : undefined),
    title: typeof info?.title === "string" ? info.title : undefined,
    timeArchived: typeof time?.archived === "number" ? time.archived : undefined,
  }
}
