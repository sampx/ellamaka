import { afterEach, describe, expect, test } from "bun:test"
import { handleNotificationClick, setNavigate } from "./notification-click"

describe("notification click", () => {
  afterEach(() => {
    setNavigate(undefined as any)
  })

  test("navigates via registered navigate function", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick("/abc/session/123")
    expect(calls).toEqual(["/abc/session/123"])
  })

  test("does not navigate when href is missing", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick(undefined)
    expect(calls).toEqual([])
  })

  test("falls back to pushState and popstate event without registered navigate", () => {
    const originalPushState = window.history.pushState
    const originalDispatchEvent = window.dispatchEvent

    let pushStateCalled = false
    let popstateFired = false

    window.history.pushState = (state, title, url) => {
      pushStateCalled = true
      expect(url).toBe("/abc/session/123")
    }

    window.dispatchEvent = (event) => {
      if (event instanceof PopStateEvent && event.type === "popstate") {
        popstateFired = true
      }
      return true
    }

    try {
      handleNotificationClick("/abc/session/123")
      expect(pushStateCalled).toBe(true)
      expect(popstateFired).toBe(true)
    } finally {
      window.history.pushState = originalPushState
      window.dispatchEvent = originalDispatchEvent
    }
  })
})
