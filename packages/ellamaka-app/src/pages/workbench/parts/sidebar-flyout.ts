// Hover flyout behavior for the collapsed SpaceRail: hovering the sessions
// activity icon temporarily reveals the session tree as an overlay, moving out
// hides it again. Clicking the icon still toggles the pinned sidebar and must
// suppress the flyout while pinned open.

export const FLYOUT_HIDE_DELAY_MS = 150

// The flyout DOM stays mounted for the whole session; visibility is toggled
// with CSS so the session tree keeps its scroll position, expansion state,
// and loaded data across hovers. Never unmount to hide.
export function flyoutVisibilityClass(open: boolean): string {
  return open ? "opacity-100" : "opacity-0 invisible pointer-events-none"
}

export interface FlyoutController {
  isOpen: () => boolean
  onTriggerEnter: () => void
  onTriggerLeave: () => void
  onFlyoutEnter: () => void
  onFlyoutLeave: () => void
  close: () => void
  destroy: () => void
}

export function createFlyoutController(input: {
  pinned: () => boolean
  onChange?: () => void
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}): FlyoutController {
  const schedule = input.setTimeoutFn ?? setTimeout
  const cancel = input.clearTimeoutFn ?? clearTimeout
  const notify = () => input.onChange?.()

  let open = false
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

  const close = () => {
    cancelPending()
    setOpen(false)
  }

  return {
    isOpen: () => open && !input.pinned(),
    onTriggerEnter: () => {
      if (input.pinned()) return
      cancelPending()
      setOpen(true)
    },
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
