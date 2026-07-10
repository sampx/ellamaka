type SplitTerminalState = {
  open: boolean
  ptyId?: string
}

export function splitTerminalTitle(title: string | undefined, fallback: string) {
  return title?.trim() || fallback
}

export function reconcileSplitTerminalState(
  state: SplitTerminalState,
  action: "show" | "hide" | "teardown",
): SplitTerminalState {
  if (action === "show") return { open: true, ptyId: state.ptyId }
  if (action === "hide") return { open: false, ptyId: state.ptyId }
  return { open: false, ptyId: undefined }
}
