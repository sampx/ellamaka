import { describe, expect, test } from "bun:test"
import { setInvisibleSessionDragPreview } from "./session-tree-drag-preview"

describe("setInvisibleSessionDragPreview", () => {
  test("replaces the browser default session-row preview with one transparent pixel", () => {
    const calls: [Element, number, number][] = []

    setInvisibleSessionDragPreview({
      setDragImage: (element, x, y) => calls.push([element, x, y]),
    } as Pick<DataTransfer, "setDragImage">)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBeInstanceOf(HTMLCanvasElement)
    expect(calls[0]?.[0]).toMatchObject({ width: 1, height: 1 })
    expect(calls[0]?.slice(1)).toEqual([0, 0])
  })
})
