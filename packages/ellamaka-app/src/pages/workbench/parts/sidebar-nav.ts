/** Sidebar navigation identity, kept pure so tests avoid the heavy sidebar
 * component module graph (mirrors file-tree-panel-identity.ts). */
export type SidebarNav = "sessions" | "files" | "maintenance"

/** Resolve the effective sidebar navigation, falling back from "files" to
 * "sessions" when the file tree feature is disabled (display.showFileTree=off). */
export function resolveSidebarNav(active: SidebarNav, filesEnabled: boolean): SidebarNav {
  if (active === "files" && !filesEnabled) return "sessions"
  return active
}
