import { describe, expect, test } from "bun:test"
import { reconcileSplitTerminalState } from "./panel-split-terminal"

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
