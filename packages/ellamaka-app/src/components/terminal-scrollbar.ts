const MINIMUM_TERMINAL_COLUMNS = 2
const MINIMUM_TERMINAL_ROWS = 1

export type TerminalFitMode = "strict" | "full-bleed"

const terminalGridCount = (input: {
  availableSize: number
  cellSize: number
  minimum: number
  fitMode?: TerminalFitMode
}) => {
  if (!Number.isFinite(input.availableSize)) return
  if (!Number.isFinite(input.cellSize) || input.cellSize <= 0) return

  const ratio = input.availableSize / input.cellSize
  const units = input.fitMode === "full-bleed" ? Math.round(ratio) : Math.floor(ratio)
  return Math.max(input.minimum, units)
}

export function terminalColumnsWithoutScrollbar(input: {
  containerWidth: number
  paddingLeft: number
  paddingRight: number
  cellWidth: number
  fitMode?: TerminalFitMode
}) {
  return terminalGridCount({
    availableSize: input.containerWidth - input.paddingLeft - input.paddingRight,
    cellSize: input.cellWidth,
    minimum: MINIMUM_TERMINAL_COLUMNS,
    fitMode: input.fitMode,
  })
}

export function terminalRowsForContainer(input: {
  containerHeight: number
  paddingTop: number
  paddingBottom: number
  cellHeight: number
  fitMode?: TerminalFitMode
}) {
  return terminalGridCount({
    availableSize: input.containerHeight - input.paddingTop - input.paddingBottom,
    cellSize: input.cellHeight,
    minimum: MINIMUM_TERMINAL_ROWS,
    fitMode: input.fitMode,
  })
}

type ScrollbarRenderer = {
  renderScrollbar?: (...args: unknown[]) => void
}

export function disableTerminalScrollbar(renderer: unknown) {
  const target = renderer as ScrollbarRenderer | undefined
  if (typeof target?.renderScrollbar !== "function") return
  target.renderScrollbar = () => {}
}
