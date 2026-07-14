import { describe, expect, test } from "bun:test"
import { reconcileMountedViews } from "./panel-mounted-views"

describe("reconcileMountedViews", () => {
  test("resets cached views when a different session is bound", () => {
    const next = reconcileMountedViews(new Set(["chat", "context"]), {
      prevBoundSessionId: "ses-old",
      nextBoundSessionId: "ses-new",
      slotState: "bound",
      viewMode: "chat",
    })

    expect([...next]).toEqual(["chat"])
  })

  test("keeps visited views while switching tabs inside the same session", () => {
    const next = reconcileMountedViews(new Set(["chat"]), {
      prevBoundSessionId: "ses-1",
      nextBoundSessionId: "ses-1",
      slotState: "bound",
      viewMode: "context",
    })

    expect([...next]).toEqual(["chat", "context"])
  })

  test("clears cached views when the panel becomes empty", () => {
    const next = reconcileMountedViews(new Set(["chat", "context"]), {
      prevBoundSessionId: "ses-1",
      nextBoundSessionId: undefined,
      slotState: "empty",
      viewMode: "chat",
    })

    expect([...next]).toEqual([])
  })

  test("preserves TUI view in background when hasTuiPtyId is true", () => {
    const next = reconcileMountedViews(new Set(), {
      prevBoundSessionId: "ses-1",
      nextBoundSessionId: "ses-1",
      slotState: "bound",
      viewMode: "chat",
      hasTuiPtyId: true,
    })

    expect([...next]).toEqual(["chat", "tui"])
  })
})
