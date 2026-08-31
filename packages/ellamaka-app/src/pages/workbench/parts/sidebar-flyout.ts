// Hover flyout behavior for the collapsed SpaceRail: hovering the sessions or
// files activity icon temporarily reveals the matching tree as an overlay,
// moving out hides it again. Clicking an icon still toggles the pinned sidebar
// and must suppress the flyout while pinned open.

export type FlyoutMode = "sessions" | "files"

export const FLYOUT_HIDE_DELAY_MS = 150

// The flyout DOM stays mounted for the whole session; visibility is toggled
// with CSS so the trees keep their scroll position, expansion state,
// and loaded data across hovers. Never unmount to hide.
export function flyoutVisibilityClass(open: boolean): string {
  return open ? "opacity-100" : "opacity-0 invisible pointer-events-none"
}

export interface FlyoutController {
  isOpen: () => boolean
  mode: () => FlyoutMode
  show: (mode: FlyoutMode) => void
  onTriggerEnter: (mode: FlyoutMode) => void
  onTriggerLeave: () => void
  onFlyoutEnter: () => void
  onFlyoutLeave: () => void
  close: () => void
  destroy: () => void
}

export function createFlyoutController(input: {
  pinned: () => boolean
  onChange?: (mode: FlyoutMode) => void
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}): FlyoutController {
  const schedule = input.setTimeoutFn ?? setTimeout
  const cancel = input.clearTimeoutFn ?? clearTimeout
  const notify = () => input.onChange?.(mode)

  let open = false
  let mode: FlyoutMode = "sessions"
  let timer: ReturnType<typeof setTimeout> | undefined

  const cancelPending = () => {
    if (timer === undefined) return
    cancel(timer)
    timer = undefined
  }

  const setOpen = (next: boolean) => {
    if (open === next) return
    open = next
    notify()
  }

  const show = (next: FlyoutMode) => {
    if (input.pinned()) return
    if (mode !== next) {
      mode = next
      notify()
    }
    cancelPending()
    setOpen(true)
  }

  const close = () => {
    cancelPending()
    setOpen(false)
  }

  return {
    isOpen: () => open && !input.pinned(),
    mode: () => mode,
    show,
    onTriggerEnter: show,
    onTriggerLeave: () => {
      if (!open) return
      cancelPending()
      timer = schedule(() => {
        timer = undefined
        setOpen(false)
      }, FLYOUT_HIDE_DELAY_MS)
    },
    onFlyoutEnter: () => {
      cancelPending()
    },
    onFlyoutLeave: () => {
      if (!open) return
      cancelPending()
      timer = schedule(() => {
        timer = undefined
        setOpen(false)
      }, FLYOUT_HIDE_DELAY_MS)
    },
    close,
    destroy: () => {
      cancelPending()
      open = false
    },
  }
}
