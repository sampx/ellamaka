type TerminalDimensions = {
  cols: number
  rows: number
}

type TerminalViewport = {
  scrollLeft: number
  scrollTop: number
}

export const resetTerminalViewport = (viewport: TerminalViewport) => {
  viewport.scrollLeft = 0
  viewport.scrollTop = 0
}

export const fitTerminalToContainer = (input: {
  current: TerminalDimensions
  propose: () => TerminalDimensions | undefined
  resize: (cols: number, rows: number) => void
  viewport: TerminalViewport
}) => {
  const dimensions = input.propose()
  if (!dimensions) return false

  const changed = input.current.cols !== dimensions.cols || input.current.rows !== dimensions.rows
  if (changed) input.resize(dimensions.cols, dimensions.rows)
  resetTerminalViewport(input.viewport)
  return changed
}
