import { describe, expect, test } from "bun:test"
import { fitTerminalToContainer } from "./terminal-fit"

describe("terminal fit synchronization", () => {
  test("resizes again when font metrics change the proposed grid", () => {
    const resizeCalls: Array<[number, number]> = []
    const viewport = { scrollLeft: 7, scrollTop: 216 }

    const resized = fitTerminalToContainer({
      current: { cols: 109, rows: 42 },
      propose: () => ({ cols: 109, rows: 32 }),
      resize: (cols, rows) => resizeCalls.push([cols, rows]),
      viewport,
    })

    expect(resized).toBe(true)
    expect(resizeCalls).toEqual([[109, 32]])
    expect(viewport.scrollLeft).toBe(0)
    expect(viewport.scrollTop).toBe(0)
  })

  test("keeps the full-bleed viewport anchored when the grid already fits", () => {
    let resizeCalls = 0
    const viewport = { scrollLeft: 3, scrollTop: 16 }

    const resized = fitTerminalToContainer({
      current: { cols: 109, rows: 32 },
      propose: () => ({ cols: 109, rows: 32 }),
      resize: () => {
        resizeCalls += 1
      },
      viewport,
    })

    expect(resized).toBe(false)
    expect(resizeCalls).toBe(0)
    expect(viewport.scrollLeft).toBe(0)
    expect(viewport.scrollTop).toBe(0)
  })

  test("does nothing until dimensions can be proposed", () => {
    const viewport = { scrollLeft: 4, scrollTop: 8 }

    const resized = fitTerminalToContainer({
      current: { cols: 80, rows: 24 },
      propose: () => undefined,
      resize: () => {
        throw new Error("resize should not run")
      },
      viewport,
    })

    expect(resized).toBe(false)
    expect(viewport).toEqual({ scrollLeft: 4, scrollTop: 8 })
  })
})
