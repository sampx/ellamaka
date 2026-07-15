import { describe, expect, test } from "bun:test"
import {
  shouldAcceptSessionDrop,
  shouldNotifySessionRemoval,
  sessionDropRejection,
  sessionRemovalReasonFromEvent,
  shouldRestoreBoundSession,
  shouldSyncSessionTitle,
  disconnectRecovery,
  workbenchSessionEvent,
} from "./panel-session-lifecycle"

describe("shouldAcceptSessionDrop", () => {
  test("silently rejects drops onto a panel that already has a session", () => {
    expect(shouldAcceptSessionDrop({ targetSlotState: "bound", sourceHasLiveBinding: false })).toBe(false)
  })

  test("rejects reopening a session that is already bound in another panel", () => {
    expect(shouldAcceptSessionDrop({ targetSlotState: "empty", sourceHasLiveBinding: true })).toBe(false)
  })

  test("accepts an unbound session in an empty panel", () => {
    expect(shouldAcceptSessionDrop({ targetSlotState: "empty", sourceHasLiveBinding: false })).toBe(true)
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

describe("sessionRemovalReasonFromEvent", () => {
  test("ignores cache state and non-destructive session updates", () => {
    expect(sessionRemovalReasonFromEvent({ type: "session.updated" })).toBeUndefined()
  })

  test("identifies an explicit server deletion", () => {
    expect(sessionRemovalReasonFromEvent({ type: "session.deleted" })).toBe("deleted")
  })

  test("identifies an externally archived session", () => {
    expect(sessionRemovalReasonFromEvent({ type: "session.updated", timeArchived: 1 })).toBe("archived")
  })
})

describe("shouldNotifySessionRemoval", () => {
  test("notifies when an externally removed Session was bound and is now released", () => {
    expect(shouldNotifySessionRemoval({ affectedPanelCount: 1, isBound: false })).toBe(true)
  })

  test("does not notify for an unbound Session or before its binding is released", () => {
    expect(shouldNotifySessionRemoval({ affectedPanelCount: 0, isBound: false })).toBe(false)
    expect(shouldNotifySessionRemoval({ affectedPanelCount: 1, isBound: true })).toBe(false)
  })
})

describe("shouldSyncSessionTitle", () => {
  test("returns false for non-session.updated events", () => {
    expect(shouldSyncSessionTitle({ type: "session.created", sessionId: "s1", title: "Hello", localTitle: "Old" })).toBe(false)
    expect(shouldSyncSessionTitle({ type: "session.deleted", sessionId: "s1", title: "Hello", localTitle: "Old" })).toBe(false)
  })

  test("returns false when sessionId or title is missing", () => {
    expect(shouldSyncSessionTitle({ type: "session.updated", title: "Hello", localTitle: "Old" })).toBe(false)
    expect(shouldSyncSessionTitle({ type: "session.updated", sessionId: "s1", localTitle: "Old" })).toBe(false)
    expect(shouldSyncSessionTitle({ type: "session.updated", sessionId: "s1", title: "", localTitle: "Old" })).toBe(false)
  })

  test("returns false when the session is not tracked locally", () => {
    expect(shouldSyncSessionTitle({ type: "session.updated", sessionId: "s1", title: "Hello" })).toBe(false)
    expect(shouldSyncSessionTitle({ type: "session.updated", sessionId: "s1", title: "Hello", localTitle: undefined })).toBe(false)
  })

  test("returns false when the title has not changed", () => {
    expect(shouldSyncSessionTitle({ type: "session.updated", sessionId: "s1", title: "Same", localTitle: "Same" })).toBe(false)
  })

  test("returns true when the title differs from the local store", () => {
    expect(shouldSyncSessionTitle({ type: "session.updated", sessionId: "s1", title: "New Title", localTitle: "Old Title" })).toBe(true)
  })
})

describe("disconnectRecovery", () => {
  test("returns reconnect when the PTY is still alive after a WebSocket close", () => {
    expect(disconnectRecovery({ ptyAlive: true })).toBe("reconnect")
  })

  test("returns fallback when the PTY has been reaped (404)", () => {
    expect(disconnectRecovery({ ptyAlive: false })).toBe("fallback")
  })
})

describe("workbenchSessionEvent", () => {
  test("ignores an event without session details", () => {
    expect(workbenchSessionEvent()).toEqual({
      type: undefined,
      sessionId: undefined,
      title: undefined,
      timeArchived: undefined,
    })
  })

  test("reads the session id from an incremental session.updated payload", () => {
    expect(
      workbenchSessionEvent({
        type: "session.updated",
        properties: {
          sessionID: "ses_1",
          info: { title: "Generated title" },
        },
      }),
    ).toEqual({
      type: "session.updated",
      sessionId: "ses_1",
      title: "Generated title",
      timeArchived: undefined,
    })
  })

  test("uses the complete session payload for creation and deletion events", () => {
    expect(
      workbenchSessionEvent({
        type: "session.deleted",
        properties: {
          sessionID: "ses_2",
          info: { id: "ses_2", time: { archived: 10 } },
        },
      }),
    ).toEqual({
      type: "session.deleted",
      sessionId: "ses_2",
      title: undefined,
      timeArchived: 10,
    })
  })
})
