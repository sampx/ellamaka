import { app, dialog, BrowserWindow } from "electron"
import type { SidecarRuntimeState } from "../preload/types"
import { getStore } from "./store"

let forceQuit = false
let confirmShowing = false

/**
 * Returns true when the sidecar is actively running, meaning a quit
 * would terminate backend processes and PTY sessions.
 */
export function shouldConfirmQuit(state: SidecarRuntimeState | undefined): boolean {
  if (!state) return false
  return state.status === "ready" || state.status === "starting" || state.status === "restarting"
}

function getLocaleText() {
  let lang = ""
  try {
    const raw = getStore("opencode.global.dat").get("language")
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as { locale?: string }
        if (typeof parsed?.locale === "string") lang = parsed.locale
      } catch {
        lang = raw
      }
    } else if (raw && typeof raw === "object" && "locale" in raw) {
      const val = (raw as { locale?: string }).locale
      if (typeof val === "string") lang = val
    }
  } catch {}

  if (!lang) {
    try {
      lang = app.getLocale()
    } catch {}
  }

  const isZh = lang.toLowerCase().startsWith("zh")
  if (isZh) {
    return {
      title: "退出 Ellamaka",
      message: "确定要退出 Ellamaka 吗？",
      detail: "后台 AI 引擎与终端会话正在运行中。退出应用将终止所有正在进行的任务。",
      buttons: ["退出应用", "取消"],
    }
  }

  return {
    title: "Quit Ellamaka?",
    message: "Are you sure you want to quit Ellamaka?",
    detail: "The AI backend and terminal sessions are running. Quitting will terminate all active tasks.",
    buttons: ["Quit", "Cancel"],
  }
}

/**
 * Shows a native confirmation dialog before quitting.
 * Returns true if the user confirmed, false if cancelled.
 */
export async function confirmQuit(win: BrowserWindow | null): Promise<boolean> {
  if (confirmShowing) return false
  confirmShowing = true
  try {
    const text = getLocaleText()
    const options = {
      type: "warning" as const,
      buttons: text.buttons,
      defaultId: 1,
      cancelId: 1,
      title: text.title,
      message: text.message,
      detail: text.detail,
    }
    const result = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
    return result.response === 0
  } finally {
    confirmShowing = false
  }
}

/**
 * Installs a `before-quit` guard that conditionally prompts the user
 * for confirmation when the sidecar is actively running.
 *
 * On macOS, also:
 * - Prevents `window-all-closed` from quitting the app.
 * - Re-shows the main window on `activate` (Dock click).
 * - Intercepts `close` on the main window, hiding instead of destroying.
 */
export function enableQuitGuard(deps: {
  getMainWindow: () => BrowserWindow | null
  getSidecarState: () => SidecarRuntimeState | undefined
}) {
  const { getMainWindow, getSidecarState } = deps

  // macOS: prevent quit when all windows are closed (keep Dock alive)
  app.on("window-all-closed", () => {
    if (process.platform === "darwin") {
      // Do nothing — app stays in Dock
      return
    }
    // On other platforms, default behavior (quit) applies automatically
  })

  // macOS: re-show hidden window when Dock icon is clicked
  app.on("activate", () => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
    }
  })

  // Guard quit with confirmation when sidecar is active
  app.on("before-quit", (e) => {
    if (forceQuit || confirmShowing) return

    const state = getSidecarState()
    if (!shouldConfirmQuit(state)) return

    e.preventDefault()
    const win = getMainWindow()
    void confirmQuit(win).then((confirmed) => {
      if (confirmed) {
        forceQuit = true
        app.quit()
      }
    })
  })
}

/**
 * Intercepts the `close` event on a BrowserWindow so that on macOS
 * the window is hidden rather than destroyed, keeping the app alive
 * in the Dock.
 *
 * Must be called after the window is created.
 */
export function interceptWindowClose(win: BrowserWindow) {
  win.on("close", (e) => {
    if (forceQuit) return
    if (process.platform !== "darwin") return

    e.preventDefault()
    win.hide()
  })
}

/**
 * Resets the force-quit flag. Used in tests.
 */
export function resetQuitGuard() {
  forceQuit = false
  confirmShowing = false
}
