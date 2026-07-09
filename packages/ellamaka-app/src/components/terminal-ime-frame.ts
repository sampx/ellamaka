type TerminalImeFrameInput = {
  cursorX: number
  cursorY: number
  cellWidth: number
  cellHeight: number
  paddingLeft: number
  paddingTop: number
}

export function getTerminalImeFrame(input: TerminalImeFrameInput) {
  return {
    left: `${input.paddingLeft + input.cursorX * input.cellWidth}px`,
    top: `${input.paddingTop + input.cursorY * input.cellHeight}px`,
    width: `${input.cellWidth}px`,
    height: `${input.cellHeight}px`,
    opacity: "0.01",
  }
}
