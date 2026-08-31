import { describe, expect, test } from "bun:test"
import { closeViewerTab, createFileScroller, fileViewerRoute, openViewerFile, resolveFileViewerState, viewerTabKey } from "./file-viewer-adapter"

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

describe("openViewerFile", () => {
  const a = { directory: "/space-a", filePath: "/space-a/main.ts" }
  const b = { directory: "/space-a", filePath: "/space-a/other.ts" }

  test("appends and activates a new file (activating is derived by caller)", () => {
    expect(openViewerFile([], a)).toEqual([a])
    expect(openViewerFile([a], b)).toEqual([a, b])
  })

  test("does not duplicate an already-open file", () => {
    expect(openViewerFile([a, b], { ...a })).toEqual([a, b])
  })

  test("same path in a different directory is a distinct tab", () => {
    const inOtherDir = { directory: "/space-b", filePath: a.filePath }
    expect(openViewerFile([a], inOtherDir)).toEqual([a, inOtherDir])
  })
})

describe("closeViewerTab", () => {
  const a = { directory: "/space-a", filePath: "/space-a/main.ts" }
  const b = { directory: "/space-a", filePath: "/space-a/other.ts" }
  const c = { directory: "/space-a", filePath: "/space-a/third.ts" }
  const keyA = viewerTabKey(a)
  const keyB = viewerTabKey(b)
  const keyC = viewerTabKey(c)

  test("closing the active tab activates the right neighbour", () => {
    expect(closeViewerTab([a, b, c], keyA, keyA)).toEqual({ tabs: [b, c], activeKey: keyB })
    expect(closeViewerTab([a, b, c], keyC, keyC)).toEqual({ tabs: [a, b], activeKey: keyB })
  })

  test("closing a background tab keeps the current selection", () => {
    expect(closeViewerTab([a, b, c], keyC, keyA)).toEqual({ tabs: [b, c], activeKey: keyC })
  })

  test("closing the last remaining tab clears the active key", () => {
    expect(closeViewerTab([a], keyA, keyA)).toEqual({ tabs: [], activeKey: undefined })
  })

  test("closing an unknown tab is a no-op", () => {
    expect(closeViewerTab([a, b], keyB, viewerTabKey({ directory: "/unknown", filePath: "/x.ts" }))).toEqual({
      tabs: [a, b],
      activeKey: keyB,
    })
  })
})

describe("viewerTabKey", () => {
  test("produces a CSS-attribute-selector-safe key for paths with spaces", () => {
    // Regression: Kobalte Tabs.List locates the selected tab with
    // querySelector(`[data-key="${key}"]`). A raw path with a space (e.g.
    // `/Volumes/x/spaces/common .gitignore`) throws "not a valid selector".
    const key = viewerTabKey({ directory: "/Volumes/U500G/spaces/common", filePath: "/Volumes/U500G/spaces/common .gitignore" })
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(key).not.toContain("/")
  })

  test("is stable and unique per directory+path pair", () => {
    const a = { directory: "/space-a", filePath: "/space-a/main.ts" }
    expect(viewerTabKey(a)).toBe(viewerTabKey({ ...a }))
    expect(viewerTabKey(a)).not.toBe(viewerTabKey({ directory: "/space-b", filePath: a.filePath }))
    expect(viewerTabKey(a)).not.toBe(viewerTabKey({ directory: "/space-a", filePath: "/space-a/other.ts" }))
  })
})
