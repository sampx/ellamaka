import { describe, expect, test } from "bun:test"
import { createFileScroller, fileViewerRoute, resolveFileViewerState } from "./file-viewer-adapter"

describe("fileViewerRoute", () => {
  test("changes the keyed router identity for a new file or directory", () => {
    const a = fileViewerRoute("/fixtures/workspaces/space-a", "src/main.ts")
    const nextFile = fileViewerRoute("/fixtures/workspaces/space-a", "src/other.ts")
    const nextDirectory = fileViewerRoute("/fixtures/workspaces/space-b", "src/main.ts")

    expect(a.key).not.toBe(nextFile.key)
    expect(nextFile.key).not.toBe(nextDirectory.key)
    expect(nextFile.path).toContain("/viewer/")
    expect(nextFile.path).toBe(nextFile.path.replace(/\/+$/, ""))
  })
})

describe("resolveFileViewerState", () => {
  test("resolves loaded as the highest-priority state", () => {
    expect(resolveFileViewerState({ loaded: true, loading: true, error: "boom" })).toBe("loaded")
  })

  test("resolves error above loading", () => {
    expect(resolveFileViewerState({ loading: true, error: "boom" })).toBe("error")
  })

  test("resolves loading when neither loaded nor errored", () => {
    expect(resolveFileViewerState({ loading: true })).toBe("loading")
  })

  test("falls back to empty when nothing is present", () => {
    expect(resolveFileViewerState({})).toBe("empty")
  })
})

function primitiveStore(initial: { top?: number; left?: number } = {}) {
  const state = { top: initial.top, left: initial.left }
  const writes: { type: "top" | "left"; value: number }[] = []
  const scroller = createFileScroller({
    scrollTop: () => state.top,
    scrollLeft: () => state.left,
    setScrollTop: (_, v) => {
      state.top = v
      writes.push({ type: "top", value: v })
    },
    setScrollLeft: (_, v) => {
      state.left = v
      writes.push({ type: "left", value: v })
    },
  })
  return { state, writes, scroller }
}

describe("createFileScroller", () => {
  test("reads a combined position and returns undefined when nothing is set", () => {
    const { scroller } = primitiveStore()
    expect(scroller.scroll("/a/file.ts")).toBeUndefined()
  })

  test("coalesces partial reads into a complete position", () => {
    const { scroller } = primitiveStore({ top: 40 })
    expect(scroller.scroll("/a/file.ts")).toEqual({ x: 0, y: 40 })
  })

  test("returns the full stored position", () => {
    const { scroller } = primitiveStore({ top: 10, left: 20 })
    expect(scroller.scroll("/a/file.ts")).toEqual({ x: 20, y: 10 })
  })

  test("writes a full position", () => {
    const { writes, scroller } = primitiveStore()
    scroller.setScroll("/a/file.ts", { x: 5, y: 6 })
    expect(writes).toEqual([
      { type: "left", value: 5 },
      { type: "top", value: 6 },
    ])
  })

  test("does not rewrite unchanged coordinates (same value is a no-op)", () => {
    const { writes, scroller } = primitiveStore({ top: 10, left: 20 })
    scroller.setScroll("/a/file.ts", { x: 20, y: 10 })
    expect(writes).toEqual([])
  })
})
