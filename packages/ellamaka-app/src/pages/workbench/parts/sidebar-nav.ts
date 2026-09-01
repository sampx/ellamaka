/** Sidebar navigation identity, kept pure so tests avoid the heavy sidebar
 * component module graph (mirrors file-tree-panel-identity.ts). */
export type SidebarNav = "sessions" | "files" | "maintenance"

export const SIDEBAR_NAV_VALUES: readonly SidebarNav[] = ["sessions", "files", "maintenance"]

export function coerceSidebarNav(value: unknown): SidebarNav {
  return SIDEBAR_NAV_VALUES.includes(value as SidebarNav) ? (value as SidebarNav) : "sessions"
}
