import { app, dialog, BrowserWindow } from "electron"
import type { SidecarRuntimeState } from "../preload/types"
import { getStore } from "./store"

let forceQuit = false
let confirmShowing = false
let shutdownInProgress = false

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

export async function stopSidecarThenQuit(stopSidecar: () => Promise<void>, quit: () => void) {
  try {
    await Promise.race([
      stopSidecar(),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ])
  } catch {
    // Ignore sidecar cleanup errors on exit
  } finally {
    quit()
  }
}

export function enableQuitGuard(deps: {
  getMainWindow: () => BrowserWindow | null
  getSidecarState: () => SidecarRuntimeState | undefined
  stopSidecar: () => Promise<void>
}) {
  const { getMainWindow, getSidecarState, stopSidecar } = deps

  app.on("window-all-closed", () => {
    if (process.platform === "darwin" && !forceQuit) {
      return
    }
  })

  app.on("activate", () => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
    }
  })

  app.on("before-quit", (e) => {
    if (forceQuit) return

    e.preventDefault()
    if (shutdownInProgress) return

    shutdownInProgress = true
    void (async () => {
      try {
        const state = getSidecarState()
        if (shouldConfirmQuit(state)) {
          const confirmed = await confirmQuit(getMainWindow())
          if (!confirmed) {
            shutdownInProgress = false
            return
          }
        }

        forceQuit = true

        try {
          await Promise.race([
            stopSidecar(),
            new Promise((resolve) => setTimeout(resolve, 1500)),
          ])
        } catch {
          // ignore
        }

        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.destroy()
        }

        app.quit()

        setTimeout(() => {
          process.exit(0)
        }, 500)
      } catch {
        forceQuit = true
        process.exit(0)
      }
    })()
  })
}

export type WindowCloseDeps = {
  getSidecarState?: () => SidecarRuntimeState | undefined
  stopSidecar?: () => Promise<void>
}

export function interceptWindowClose(win: BrowserWindow, deps?: WindowCloseDeps) {
  win.on("close", (e) => {
    if (forceQuit) return

    if (process.platform === "darwin") {
      e.preventDefault()
      win.hide()
      return
    }

    e.preventDefault()
    if (shutdownInProgress) return

    shutdownInProgress = true
    void (async () => {
      try {
        const state = deps?.getSidecarState?.()
        if (shouldConfirmQuit(state)) {
          const targetWin = win.isDestroyed() ? null : win
          const confirmed = await confirmQuit(targetWin)
          if (!confirmed) {
            shutdownInProgress = false
            return
          }
        }

        forceQuit = true

        try {
          await Promise.race([
            (deps?.stopSidecar ?? (async () => {}))(),
            new Promise((resolve) => setTimeout(resolve, 1500)),
          ])
        } catch {
          // ignore
        }

        if (!win.isDestroyed()) {
          win.destroy()
        }

        app.quit()

        setTimeout(() => {
          process.exit(0)
        }, 500)
      } catch {
        forceQuit = true
        process.exit(0)
      }
    })()
  })
}

export function resetQuitGuard() {
  forceQuit = false
  confirmShowing = false
  shutdownInProgress = false
}
