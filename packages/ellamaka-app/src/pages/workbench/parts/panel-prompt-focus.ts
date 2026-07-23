const PROMPT_EDITOR_SELECTOR = '[data-component="session-prompt-dock"] [contenteditable="true"]'
const PANEL_FOCUS_OWNER_SELECTOR =
  '[data-split-terminal], .xterm, [data-component="terminal"], [contenteditable="true"], input, textarea, select'
const PANEL_POINTER_FOCUS_OWNER_SELECTOR =
  'button, a, [contenteditable="true"], [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="dialog"], [data-prevent-autofocus], .xterm, [data-split-terminal], [data-component="terminal"], [data-component="prompt-input"], [data-component="session-prompt-dock"], input, textarea, select'

const DEFAULT_RETRY_DELAYS = [0, 50, 150, 300, 600, 1_200, 2_000] as const

type PanelPromptFocusOptions = {
  root: () => HTMLElement | undefined
  shouldFocus: () => boolean
  isPointerDown: () => boolean
  delays?: readonly number[]
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (id: number) => void
  setTimer?: (callback: () => void, delay: number) => number
  clearTimer?: (id: number) => void
}

function findPanelPromptEditor(root: HTMLElement): HTMLElement | undefined {
  const editors = root.querySelectorAll<HTMLElement>(PROMPT_EDITOR_SELECTOR)
  for (const editor of editors) {
    if (editor.isConnected) return editor
  }
  return undefined
}

function hasExpandedSelection(): boolean {
  const selection = window.getSelection()
  return !!selection && selection.rangeCount > 0 && !selection.isCollapsed
}

function focusBelongsToPanelControl(root: HTMLElement): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !root.contains(active)) return false
  return !!active.closest(PANEL_FOCUS_OWNER_SELECTOR)
}

export function shouldPreservePanelPointerFocus(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(PANEL_POINTER_FOCUS_OWNER_SELECTOR)) return true

  const userSelect = window.getComputedStyle(target).userSelect
  return userSelect === "text" || userSelect === "all"
}

export function shouldSkipPanelPromptFocusForActivation(input: {
  previousPanelActive: boolean | undefined
  panelActive: boolean
  tabActive: boolean
  lastPreservedPointerAt: number
  now: number
}): boolean {
  return (
    input.previousPanelActive === false &&
    input.panelActive &&
    input.tabActive &&
    input.lastPreservedPointerAt > 0 &&
    input.now - input.lastPreservedPointerAt < 1_000
  )
}

export function focusPromptEditor(editor: HTMLElement): boolean {
  editor.focus()
  if (document.activeElement !== editor) return false

  try {
    const selection = window.getSelection()
    if (!selection) return true
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  } catch {
    // The editor already owns focus; an unsupported Selection API must not
    // turn a successful focus into a retry loop.
  }

  return true
}

export function focusPanelPromptEditor(root: HTMLElement): boolean {
  const editor = findPanelPromptEditor(root)
  return editor ? focusPromptEditor(editor) : false
}

export function startPanelPromptFocus(options: PanelPromptFocusOptions): () => void {
  const requestFrame = options.requestFrame ?? window.requestAnimationFrame.bind(window)
  const cancelFrame = options.cancelFrame ?? window.cancelAnimationFrame.bind(window)
  const setTimer = options.setTimer ?? window.setTimeout.bind(window)
  const clearTimer = options.clearTimer ?? window.clearTimeout.bind(window)
  const delays = options.delays ?? DEFAULT_RETRY_DELAYS

  let stopped = false
  let frame: number | undefined
  let timer: number | undefined
  let retryIndex = 0
  let focusedEditor: HTMLElement | undefined

  const stop = () => {
    if (stopped) return
    stopped = true
    if (frame !== undefined) cancelFrame(frame)
    if (timer !== undefined) clearTimer(timer)
  }

  const scheduleNext = () => {
    const delay = delays[retryIndex]
    if (delay === undefined) {
      stop()
      return
    }
    retryIndex += 1
    timer = setTimer(step, delay)
  }

  function step() {
    frame = undefined
    timer = undefined
    if (stopped) return
    if (!options.shouldFocus()) {
      stop()
      return
    }

    if (focusedEditor) {
      if (focusedEditor.isConnected) {
        // Keep watching while the editor that we focused remains active. If
        // focus moved while that node is still mounted, it was a user action
        // and this campaign must not steal it back.
        if (document.activeElement !== focusedEditor) {
          stop()
          return
        }
        scheduleNext()
        return
      }
      focusedEditor = undefined
    }

    // Activation happens on mousedown so the active Panel can change while a
    // drag selection is still being formed. Retry until mouseup, then preserve
    // the resulting expanded selection instead of replacing it with a caret.
    if (!options.isPointerDown()) {
      if (hasExpandedSelection()) {
        stop()
        return
      }

      const root = options.root()
      if (root) {
        if (focusBelongsToPanelControl(root)) {
          stop()
          return
        }
        if (focusPanelPromptEditor(root)) {
          focusedEditor = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
          scheduleNext()
          return
        }
      }
    }

    scheduleNext()
  }

  frame = requestFrame(step)
  return stop
}
