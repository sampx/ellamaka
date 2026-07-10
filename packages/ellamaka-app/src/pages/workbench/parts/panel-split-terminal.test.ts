import { describe, expect, test } from "bun:test"
import { reconcileSplitTerminalState, splitTerminalTitle } from "./panel-split-terminal"

describe("reconcileSplitTerminalState", () => {
  test("hides the split terminal without clearing the running PTY", () => {
    expect(reconcileSplitTerminalState({ open: true, ptyId: "pty-1" }, "hide")).toEqual({
      open: false,
      ptyId: "pty-1",
    })
  })

  test("reopens the split terminal against the same PTY", () => {
    expect(reconcileSplitTerminalState({ open: false, ptyId: "pty-1" }, "show")).toEqual({
      open: true,
      ptyId: "pty-1",
    })
  })

  test("teardown clears the PTY identity", () => {
    expect(reconcileSplitTerminalState({ open: true, ptyId: "pty-1" }, "teardown")).toEqual({
      open: false,
      ptyId: undefined,
    })
  })
})

describe("splitTerminalTitle", () => {
  test("uses the title emitted by the terminal", () => {
    expect(splitTerminalTitle("ellamaka", "Terminal")).toBe("ellamaka")
  })

  test("falls back when the terminal has not emitted a title", () => {
    expect(splitTerminalTitle("   ", "终端")).toBe("终端")
  })
})
