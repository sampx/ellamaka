import { describe, expect, test } from "bun:test"
import { completeFork } from "./dialog-fork-completion"

describe("completeFork", () => {
  test("returns the new Session through a generic callback without navigating", () => {
    const completed: string[] = []
    const navigated: string[] = []

    completeFork({
      sessionID: "session-forked",
      href: "/encoded/session/session-forked",
      onSuccess: (sessionID) => completed.push(sessionID),
      navigate: (href) => navigated.push(href),
    })

    expect(completed).toEqual(["session-forked"])
    expect(navigated).toEqual([])
  })

  test("keeps canonical Session navigation when no adapter is provided", () => {
    const navigated: string[] = []

    completeFork({
      sessionID: "session-forked",
      href: "/encoded/session/session-forked",
      navigate: (href) => navigated.push(href),
    })

    expect(navigated).toEqual(["/encoded/session/session-forked"])
  })
})
