const INTERACTIVE_END_TARGETS = [
  "input",
  "textarea",
  "select",
  "button",
  "a",
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="dialog"]',
  ".xterm",
  '[data-component="terminal"]',
  '[data-component="prompt-input"]',
].join(", ")

/**
 * Keeps End's native editing, selection and platform-shortcut meanings intact.
 * Only an unmodified End from the transcript can request the chat's live tail.
 */
export function shouldResumeChatOnEnd(event: KeyboardEvent): boolean {
  if (
    event.key !== "End" ||
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return false
  }

  const target = event.target
  const prompt = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-component="prompt-input"]') : undefined
  // The active Workbench chat normally restores focus to an empty composer.
  // With no draft to navigate, End is more useful as the transcript shortcut;
  // any text or attachment keeps the editor's native caret behavior.
  if (prompt) return !prompt.textContent?.trim()

  if (target instanceof HTMLElement && target.closest(INTERACTIVE_END_TARGETS)) return false

  const selection = document.getSelection()
  return !selection || selection.isCollapsed
}
