/** Sidebar navigation identity, kept pure so tests avoid the heavy sidebar
 * component module graph (mirrors file-tree-panel-identity.ts). */
export type SidebarNav = "sessions" | "files" | "maintenance"
