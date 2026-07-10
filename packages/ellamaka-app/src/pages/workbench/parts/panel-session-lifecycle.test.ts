import { describe, expect, test } from "bun:test"
import {
  shouldAcceptSessionDrop,
  sessionDropRejection,
  shouldRestoreBoundSession,
  shouldUnbindSessionFromEvent,
} from "./panel-session-lifecycle"

describe("shouldAcceptSessionDrop", () => {
  test("silently rejects drops onto a panel that already has a session", () => {
    expect(shouldAcceptSessionDrop({ targetSlotState: "bound", sourceHasLiveBinding: false })).toBe(false)
  })

  test("rejects reopening a session that is already bound in another panel", () => {
    expect(shouldAcceptSessionDrop({ targetSlotState: "empty", sourceHasLiveBinding: true })).toBe(false)
  })

  test("accepts an unbound session in an empty or terminal panel", () => {
    expect(shouldAcceptSessionDrop({ targetSlotState: "empty", sourceHasLiveBinding: false })).toBe(true)
    expect(shouldAcceptSessionDrop({ targetSlotState: "open", sourceHasLiveBinding: false })).toBe(true)
  })
})

describe("sessionDropRejection", () => {
  test("explains whether the target panel or source session is already open", () => {
    expect(sessionDropRejection({ targetSlotState: "bound", sourceHasLiveBinding: false })).toBe("target-occupied")
    expect(sessionDropRejection({ targetSlotState: "empty", sourceHasLiveBinding: true })).toBe("session-already-open")
    expect(sessionDropRejection({ targetSlotState: "empty", sourceHasLiveBinding: false })).toBeUndefined()
  })
})

describe("shouldRestoreBoundSession", () => {
  test("restores a persisted binding when its local session projection is missing", () => {
    expect(shouldRestoreBoundSession({ slotState: "bound", boundSessionId: "ses-1", hasLocalSession: false })).toBe(true)
  })

  test("does not restore empty panels or bindings that already have a local reference", () => {
    expect(shouldRestoreBoundSession({ slotState: "empty", boundSessionId: undefined, hasLocalSession: false })).toBe(false)
    expect(shouldRestoreBoundSession({ slotState: "bound", boundSessionId: "ses-1", hasLocalSession: true })).toBe(false)
  })
})

describe("shouldUnbindSessionFromEvent", () => {
  test("ignores cache state and non-destructive session updates", () => {
    expect(shouldUnbindSessionFromEvent({ type: "session.updated" })).toBe(false)
  })

  test("unbinds only on an explicit server deletion or archive event", () => {
    expect(shouldUnbindSessionFromEvent({ type: "session.deleted" })).toBe(true)
    expect(shouldUnbindSessionFromEvent({ type: "session.updated", timeArchived: 1 })).toBe(true)
  })
})
