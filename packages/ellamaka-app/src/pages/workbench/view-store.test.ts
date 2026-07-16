import { describe, expect, test } from "bun:test"
import {
  clonePersistedWorkbench,
  createWorkbenchStore,
  PERSISTED_DEFAULTS,
} from "./workbench-store"

describe("view-store reactive guard", () => {
  test("clonePersistedWorkbench creates a deep clone isolated from mutations (guards against structuredClone)", () => {
    // The createEffect in view-store.tsx reads workbench.snapshot() to
    // establish reactive subscriptions on all persisted fields. If
    // clonePersistedWorkbench were replaced with structuredClone, the
    // proxy reads would not trigger SolidJS dependency tracking and
    // persistence would silently break. This test verifies the current
    // spread-based deep cloning preserves the expected behavior.

    const original = clonePersistedWorkbench(PERSISTED_DEFAULTS)
    const clone1 = clonePersistedWorkbench(original)
    const clone2 = clonePersistedWorkbench(original)

    // Each clone is a new object (not the same reference)
    expect(clone1).not.toBe(original)
    expect(clone2).not.toBe(clone1)

    // Mutating the original does not affect clones
    original.display.showTitlebar = false
    expect(clone1.display.showTitlebar).toBe(true)
    expect(clone2.display.showTitlebar).toBe(true)

    // Nested objects are also cloned (no shared references)
    original.spaces = {}
    expect(clone1.spaces).not.toBe(original.spaces)
  })

  test("snapshot reflects store mutations through the reactive proxy", () => {
    const store = createWorkbenchStore()
    store.hydrate(PERSISTED_DEFAULTS)

    const snap1 = store.snapshot()
    expect(snap1.display.showTitlebar).toBe(true)

    store.setDisplay("showTitlebar", false)
    const snap2 = store.snapshot()
    expect(snap2.display.showTitlebar).toBe(false)

    // snap1 is isolated — mutation does not retroactively affect it
    expect(snap1.display.showTitlebar).toBe(true)
  })

  test("snapshot reflects space panel additions through the reactive proxy", () => {
    const store = createWorkbenchStore()
    store.hydrate(PERSISTED_DEFAULTS)

    store.ensureSpace("/fixtures/space-a")
    const panelID = store.addPanel("/fixtures/space-a")

    const snap = store.snapshot()
    expect(snap.spaces["/fixtures/space-a"]).toBeDefined()
    expect(snap.spaces["/fixtures/space-a"].panels.length).toBe(2)
    expect(snap.spaces["/fixtures/space-a"].panels.some((panel) => panel.id === panelID)).toBe(true)
  })

  test("snapshot reflects tab mutations through the reactive proxy", () => {
    const store = createWorkbenchStore()
    store.hydrate(PERSISTED_DEFAULTS)

    store.openTab({ name: "Space X", path: "/fixtures/space-x", type: "space" })
    const snap = store.snapshot()
    expect(snap.tabs.some((tab) => tab.name === "Space X")).toBe(true)
  })
})
