import { describe, expect, test } from "bun:test"
import { createFlyoutController, flyoutVisibilityClass, FLYOUT_HIDE_DELAY_MS } from "./sidebar-flyout"

describe("flyoutVisibilityClass", () => {
  test("closed state hides via CSS visibility so the tree stays mounted", () => {
    const cls = flyoutVisibilityClass(false)
    expect(cls).toContain("invisible")
    expect(cls).toContain("pointer-events-none")
  })

  test("open state is fully visible", () => {
    const cls = flyoutVisibilityClass(true)
    expect(cls).not.toContain("invisible")
    expect(cls).not.toContain("pointer-events-none")
  })
})

describe("sidebar hover flyout", () => {
  test("opens on trigger hover when the rail is collapsed", () => {
    const flyout = createFlyoutController({ pinned: () => false })
    expect(flyout.isOpen()).toBe(false)
    flyout.onTriggerEnter()
    expect(flyout.isOpen()).toBe(true)
  })

  test("does not open on hover while the rail is pinned open", () => {
    const flyout = createFlyoutController({ pinned: () => true })
    flyout.onTriggerEnter()
    expect(flyout.isOpen()).toBe(false)
  })

  test("stays open when the pointer moves from the trigger into the flyout", () => {
    let now = 0
    const timers = new Map<ReturnType<typeof setTimeout>, () => void>()
    const flyout = createFlyoutController({
      pinned: () => false,
      setTimeoutFn: ((fn: () => void, _ms: number) => {
        const id = { fn } as unknown as ReturnType<typeof setTimeout>
        timers.set(id, fn)
        return id
      }) as typeof setTimeout,
      clearTimeoutFn: ((id: ReturnType<typeof setTimeout>) => {
        timers.delete(id)
      }) as typeof clearTimeout,
    })

    flyout.onTriggerEnter()
    flyout.onTriggerLeave()
    expect(timers.size).toBe(1)
    flyout.onFlyoutEnter()
    expect(timers.size).toBe(0)
    expect(flyout.isOpen()).toBe(true)
    void now
  })

  test("hides after the delay once the pointer leaves both trigger and flyout", () => {
    const pending: Array<() => void> = []
    const flyout = createFlyoutController({
      pinned: () => false,
      setTimeoutFn: ((fn: () => void, ms: number) => {
        expect(ms).toBe(FLYOUT_HIDE_DELAY_MS)
        pending.push(fn)
        return pending.length as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout,
      clearTimeoutFn: (() => {}) as typeof clearTimeout,
    })

    flyout.onTriggerEnter()
    flyout.onTriggerLeave()
    expect(flyout.isOpen()).toBe(true)
    pending.forEach((fn) => fn())
    expect(flyout.isOpen()).toBe(false)
  })

  test("close() hides immediately and cancels a pending hide", () => {
    const pending: Array<() => void> = []
    const flyout = createFlyoutController({
      pinned: () => false,
      setTimeoutFn: ((fn: () => void) => {
        pending.push(fn)
        return pending.length as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout,
      clearTimeoutFn: (() => {
        pending.length = 0
      }) as typeof clearTimeout,
    })

    flyout.onTriggerEnter()
    flyout.close()
    expect(flyout.isOpen()).toBe(false)
    expect(pending.length).toBe(0)
  })

  test("isOpen() reports closed once the rail becomes pinned even if open was requested", () => {
    let pinned = false
    const flyout = createFlyoutController({ pinned: () => pinned })
    flyout.onTriggerEnter()
    expect(flyout.isOpen()).toBe(true)
    pinned = true
    expect(flyout.isOpen()).toBe(false)
  })
})
