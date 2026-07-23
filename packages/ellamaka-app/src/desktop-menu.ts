export type DesktopMenuPlatform = "macos" | "windows"

export type DesktopMenuAction =
  | "app.checkForUpdates"
  | "app.showAbout"
  | "app.relaunch"
  | "app.restartSidecar"
  | "app.toggleDebugLogging"
  | "app.exportLogs"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.delete"
  | "edit.selectAll"
  | "view.reload"
  | "view.toggleDevTools"
  | "view.resetZoom"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.toggleFullscreen"
  | "window.close"
  | "window.minimize"
  | "window.toggleMaximize"

export type DesktopMenuRole =
  | "about"
  | "copy"
  | "cut"
  | "hide"
  | "hideOthers"
  | "paste"
  | "quit"
  | "redo"
  | "reload"
  | "resetZoom"
  | "selectAll"
  | "toggleDevTools"
  | "togglefullscreen"
  | "undo"
  | "unhide"
  | "windowMenu"
  | "zoomIn"
  | "zoomOut"

export type DesktopMenuItem = {
  type: "item"
  label?: string
  items?: DesktopMenuEntry[]
  command?: string
  action?: DesktopMenuAction
  role?: DesktopMenuRole
  href?: string
  accelerator?: Partial<Record<DesktopMenuPlatform, string>>
  enabled?: "updater"
  platforms?: DesktopMenuPlatform[]
}

export type DesktopMenuSeparator = {
  type: "separator"
  platforms?: DesktopMenuPlatform[]
}

export type DesktopMenuEntry = DesktopMenuItem | DesktopMenuSeparator

export type DesktopMenu = {
  id: string
  label: string
  role?: DesktopMenuRole
  items?: DesktopMenuEntry[]
  platforms?: DesktopMenuPlatform[]
}

export const DESKTOP_MENU: DesktopMenu[] = [
  {
    id: "file",
    label: "File",
    platforms: ["windows"],
    items: [
      { type: "item", label: "Settings...", command: "settings.open", accelerator: { windows: "Ctrl+," } },
      { type: "separator" },
      { type: "item", label: "Exit", role: "quit" },
    ],
  },
  {
    id: "app",
    label: "Ellamaka",
    platforms: ["macos"],
    items: [
      { type: "item", role: "about" },
      { type: "item", label: "Check for Updates...", action: "app.checkForUpdates", enabled: "updater" },
      { type: "item", label: "Settings...", command: "settings.open", accelerator: { macos: "Cmd+," } },
      { type: "separator" },
      { type: "item", role: "hide" },
      { type: "item", role: "hideOthers" },
      { type: "item", role: "unhide" },
      { type: "separator" },
      { type: "item", role: "quit" },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    items: [
      {
        type: "item",
        label: "Undo",
        action: "edit.undo",
        role: "undo",
        accelerator: { macos: "Cmd+Z", windows: "Ctrl+Z" },
      },
      {
        type: "item",
        label: "Redo",
        action: "edit.redo",
        role: "redo",
        accelerator: { macos: "Cmd+Shift+Z", windows: "Ctrl+Y" },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Cut",
        action: "edit.cut",
        role: "cut",
        accelerator: { macos: "Cmd+X", windows: "Ctrl+X" },
      },
      {
        type: "item",
        label: "Copy",
        action: "edit.copy",
        role: "copy",
        accelerator: { macos: "Cmd+C", windows: "Ctrl+C" },
      },
      {
        type: "item",
        label: "Paste",
        action: "edit.paste",
        role: "paste",
        accelerator: { macos: "Cmd+V", windows: "Ctrl+V" },
      },
      { type: "item", label: "Delete", action: "edit.delete" },
      {
        type: "item",
        label: "Select All",
        action: "edit.selectAll",
        role: "selectAll",
        accelerator: { macos: "Cmd+A", windows: "Ctrl+A" },
      },
    ],
  },
  {
    id: "view",
    label: "View",
    items: [
      {
        type: "item",
        label: "Toggle Sidebar",
        command: "sidebar.toggle",
        accelerator: { macos: "Cmd+B", windows: "Ctrl+B" },
      },
      { type: "separator" },
      { type: "item", label: "Reload", action: "view.reload", role: "reload" },
      { type: "item", label: "Toggle Developer Tools", action: "view.toggleDevTools", role: "toggleDevTools" },
      { type: "separator" },
      {
        type: "item",
        label: "Actual Size",
        action: "view.resetZoom",
        role: "resetZoom",
        accelerator: { macos: "Cmd+0", windows: "Ctrl+0" },
      },
      {
        type: "item",
        label: "Zoom In",
        action: "view.zoomIn",
        role: "zoomIn",
        accelerator: { macos: "Cmd+=", windows: "Ctrl++" },
      },
      {
        type: "item",
        label: "Zoom Out",
        action: "view.zoomOut",
        role: "zoomOut",
        accelerator: { macos: "Cmd+-", windows: "Ctrl+-" },
      },
      { type: "separator" },
      { type: "item", label: "Toggle Full Screen", action: "view.toggleFullscreen", role: "togglefullscreen" },
    ],
  },
  {
    id: "window",
    label: "Window",
    items: [
      { type: "item", label: "Minimize", action: "window.minimize" },
      { type: "item", label: "Maximize", action: "window.toggleMaximize" },
      { type: "separator" },
      { type: "item", label: "Close Tab", command: "tab.close", accelerator: { macos: "Cmd+W", windows: "Ctrl+W" } },
      { type: "item", label: "Close Window", action: "window.close", platforms: ["windows"] },
    ],
  },
  {
    id: "help",
    label: "Help",
    items: [
      {
        type: "item",
        label: "Check for Updates...",
        action: "app.checkForUpdates",
        enabled: "updater",
        platforms: ["windows"],
      },
      { type: "separator", platforms: ["windows"] },
      { type: "item", label: "Ellamaka Documentation", href: "https://wopal.cn/docs" },
      { type: "item", label: "Report Issue / Share Feedback", href: "https://github.com/sampx/wopal-space/issues" },
      { type: "separator" },
      { type: "item", label: "Enable Debug Logging", action: "app.toggleDebugLogging", platforms: ["macos"] },
      { type: "item", label: "Restart Sidecar Service", action: "app.restartSidecar", platforms: ["macos"] },
      { type: "item", label: "Export Diagnostic Logs...", action: "app.exportLogs", platforms: ["macos"] },
      {
        type: "item",
        label: "Diagnostics",
        platforms: ["windows"],
        items: [
          { type: "item", label: "Restart Local Server", action: "app.restartSidecar" },
          { type: "item", label: "Export Diagnostic Logs...", action: "app.exportLogs" },
          { type: "item", label: "Enable Debug Logging", action: "app.toggleDebugLogging" },
        ],
      },
      { type: "separator", platforms: ["windows"] },
      { type: "item", label: "About Ellamaka", action: "app.showAbout", platforms: ["windows"] },
    ],
  },
]

export function desktopMenuVisible(item: { platforms?: DesktopMenuPlatform[] }, platform: DesktopMenuPlatform) {
  return !item.platforms || item.platforms.includes(platform)
}
