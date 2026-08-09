import { describe, expect, test } from "bun:test"
import { createWindowShowGuard, recoverMainWindow } from "./window-show-guard"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function makeWin(overrides: Partial<{ destroyed: boolean; visible: boolean }> = {}) {
  const calls: string[] = []
  const win = {
    isDestroyed: () => overrides.destroyed ?? false,
    isVisible: () => overrides.visible ?? false,
    show: () => {
      calls.push("show")
    },
    focus: () => {
      calls.push("focus")
    },
  }
  return { win, calls }
}

describe("createWindowShowGuard", () => {
  test("force-shows the window when the fallback timer fires and it is not visible", async () => {
    const { win, calls } = makeWin()
    createWindowShowGuard(win, 10)
    await sleep(30)
    expect(calls).toEqual(["show"])
  })

  test("does not show when the window is already visible", async () => {
    const { win, calls } = makeWin({ visible: true })
    createWindowShowGuard(win, 10)
    await sleep(30)
    expect(calls).toEqual([])
  })

  test("does not show when the window is destroyed", async () => {
    const { win, calls } = makeWin({ destroyed: true })
    createWindowShowGuard(win, 10)
    await sleep(30)
    expect(calls).toEqual([])
  })

  test("cancel clears the timer so the window is never force-shown", async () => {
    const { win, calls } = makeWin()
    const guard = createWindowShowGuard(win, 10)
    guard.cancel()
    await sleep(30)
    expect(calls).toEqual([])
  })

  test("showIfNeeded shows immediately and clears the pending timer", async () => {
    const { win, calls } = makeWin()
    const guard = createWindowShowGuard(win, 10)
    guard.showIfNeeded()
    await sleep(30)
    expect(calls).toEqual(["show"])
  })

  test("showIfNeeded is a no-op when the window is already visible", async () => {
    const { win, calls } = makeWin({ visible: true })
    const guard = createWindowShowGuard(win, 10)
    guard.showIfNeeded()
    await sleep(30)
    expect(calls).toEqual([])
  })

  test("showIfNeeded is a no-op when the window is destroyed", async () => {
    const { win, calls } = makeWin({ destroyed: true })
    const guard = createWindowShowGuard(win, 10)
    guard.showIfNeeded()
    await sleep(30)
    expect(calls).toEqual([])
  })
})

describe("recoverMainWindow", () => {
  test("shows and focuses an existing live window", () => {
    const { win, calls } = makeWin()
    const result = recoverMainWindow(win, () => {
      throw new Error("should not create a new window")
    })
    expect(result).toBe(win)
    expect(calls).toEqual(["show", "focus"])
  })

  test("creates a new window when current is null", () => {
    const created = makeWin().win
    const result = recoverMainWindow(null, () => created)
    expect(result).toBe(created)
  })

  test("creates a new window when current is destroyed", () => {
    const { win } = makeWin({ destroyed: true })
    const created = makeWin().win
    const result = recoverMainWindow(win, () => created)
    expect(result).toBe(created)
  })
})
