const INPUT_CONTROL_SELECTOR =
  '[data-split-terminal], .xterm, [data-component="terminal"], [contenteditable="true"], input, textarea, select'

/**
 * True when the current focus lives inside an input control outside the
 * prompt editor (terminal, another prompt editor, a text field). Restoring
 * prompt focus in that case would steal the user's caret from another
 * input surface.
 */
export function shouldSkipRestoreFocus(editor: HTMLElement): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !active.isConnected) return false
  if (active === editor || editor.contains(active)) return false
  return !!active.closest(INPUT_CONTROL_SELECTOR)
}
