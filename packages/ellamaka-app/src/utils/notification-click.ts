let nav: ((href: string) => void) | undefined

export const setNavigate = (fn: (href: string) => void) => {
  nav = fn
}

export const handleNotificationClick = (href?: string) => {
  window.focus()
  if (!href) return
  if (nav) {
    nav(href)
    return
  }
  console.warn("notification-click: navigate function not set, using pushState fallback")
  try {
    window.history.pushState(null, "", href)
    window.dispatchEvent(new PopStateEvent("popstate"))
  } catch (error) {
    console.error("notification-click: pushState fallback failed, falling back to location.assign", error)
    window.location.assign(href)
  }
}
