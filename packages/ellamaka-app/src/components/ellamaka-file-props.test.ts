import { describe, expect, test } from "bun:test"
import { ellamakaFileProps } from "./ellamaka-file-props"

describe("ellamakaFileProps", () => {
  test("forces classic diff indicators", () => {
    const props = ellamakaFileProps({ mode: "diff", fileDiff: {} })
    expect(props.diffIndicators).toBe("classic")
  })

  test("overrides an existing diffIndicators value", () => {
    const props = ellamakaFileProps({ mode: "diff", diffIndicators: "bars" })
    expect(props.diffIndicators).toBe("classic")
  })

  test("passes through all other props untouched", () => {
    const source = { mode: "diff", fileDiff: {}, class: "foo", virtualize: false }
    const props = ellamakaFileProps(source)
    expect(props).toEqual({ ...source, diffIndicators: "classic" })
  })

  test("leaves text mode props intact apart from the indicator", () => {
    const source = { mode: "text", file: { name: "a.ts", contents: "x" } }
    const props = ellamakaFileProps(source)
    expect(props.mode).toBe("text")
    expect(props.file).toEqual({ name: "a.ts", contents: "x" })
    expect(props.diffIndicators).toBe("classic")
  })
})
