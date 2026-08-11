export type PromptSurfaceMode = "prompt" | "prompt-disabled" | "child-disabled"

/**
 * Decides how the composer prompt surface should render.
 *
 * The prompt stays mounted while a permission/question request blocks the
 * session — only its interactivity changes — so that popover state (at/slash)
 * survives blocked toggles. A child session replaces the prompt entirely
 * because its composer is disabled by design.
 */
export function promptSurfaceMode(input: { blocked: boolean; child: boolean }): PromptSurfaceMode {
  if (input.child) return "child-disabled"
  if (input.blocked) return "prompt-disabled"
  return "prompt"
}
