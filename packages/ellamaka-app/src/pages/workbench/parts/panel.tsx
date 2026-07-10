import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { Show, createEffect, onCleanup, For, createSignal, on } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { Terminal } from "@/components/terminal"
import { useWorkbenchState } from "../view"
import { useSessionStore } from "../session-store"
import { getView, listViews } from "../view-registry"
import { PanelLoader } from "./panel-loader"
import { getPanelHeaderViews } from "./panel-header-views"
import { reconcileMountedViews } from "./panel-mounted-views"
import { reconcileSplitTerminalState } from "./panel-split-terminal"
import { sessionDropRejection, shouldAcceptSessionDrop, shouldRestoreBoundSession } from "./panel-session-lifecycle"
import type { WorkbenchPanel, PanelMode } from "../view"

export function Panel(props: {
  panel: WorkbenchPanel
  spaceName: string
  spacePath: string
  isActive: boolean
  panelCount: number
  onActivate: () => void
  onModeChange: (mode: PanelMode) => void
  onRemove: () => void
}) {
  const language = useLanguage()
  const t = (k: string, params?: Record<string, string | number | boolean>) => language.t(k as any, params)
  const sdk = useSDK()
  const wb = useWorkbenchState()
  const { setPanelPtyId, setPanelSplitTerminal } = wb
  const sessionStore = useSessionStore()
  const dialog = useDialog()

  const [mountedViews, setMountedViews] = createSignal<Set<string>>(new Set())

  createEffect(
    on(
      () => [props.panel.boundSessionId, props.panel.slotState, props.panel.viewMode] as const,
      ([nextBoundSessionId, slotState, viewMode], previous) => {
        setMountedViews((prev) => reconcileMountedViews(prev, {
          prevBoundSessionId: previous?.[0],
          nextBoundSessionId,
          slotState,
          viewMode,
        }))
      },
    ),
  )

  const canRemove = () => {
    if (props.panel.slotState === "empty" && props.panelCount <= 1) return false
    return true
  }
  const title = () => {
    if (props.panel.slotState === "bound") {
      const session = sessionStore.getSession(props.panel.boundSessionId ?? "")
      return session?.title ?? "Session"
    }
    if (props.panel.slotState === "open") return props.panel.directory
    const parts = props.panel.id.split("-")
    return `Panel #${parts[parts.length - 1] ?? props.panel.id}`
  }
  const headerViews = () => getPanelHeaderViews(listViews(), props.panel.slotState)
  const restoringSessionIDs = new Set<string>()

  createEffect(() => {
    const sessionID = props.panel.boundSessionId
    const existing = sessionID ? sessionStore.getSession(sessionID) : undefined
    if (!shouldRestoreBoundSession({
      slotState: props.panel.slotState,
      boundSessionId: sessionID,
      hasLocalSession: !!existing,
    })) return
    if (!sessionID || restoringSessionIDs.has(sessionID)) return

    restoringSessionIDs.add(sessionID)
    void sdk.client.session.get({ sessionID })
      .then((result) => {
        const session = result.data
        if (!session) return
        sessionStore.ensureSessionReference(
          session.id,
          props.spaceName,
          session.directory || props.panel.directory,
          "chat",
          session.title || session.id,
        )
      })
      .catch((error) => {
        console.error("Failed to restore bound session:", error)
      })
      .finally(() => {
        restoringSessionIDs.delete(sessionID)
      })
  })

  createEffect(() => {
    const spacePath = props.spacePath
    if (!spacePath) return
    if (props.panel.slotState !== "bound") return
    if (props.panel.viewMode !== "terminal") return
    if (!props.panel.splitTerminal) {
      setPanelSplitTerminal(spacePath, props.panel.id, true)
    }
    wb.setPanelViewMode(spacePath, props.panel.id, "tui")
  })
  // Split terminal PTY is managed by panel.tsx (separate from view-registry main view PTY)
  createEffect(() => {
    const splitOpen = props.panel.splitTerminal
    const directory = props.panel.directory
    const spacePath = props.spacePath

    if (!spacePath) return

    if (splitOpen && !props.panel.splitPtyId) {
      sdk.client.pty
        .create({
          cwd: directory,
          title: `Split Terminal (${props.panel.id})`,
        })
        .then((res) => {
          const ptyId = res.data?.id
          if (ptyId) {
            setPanelPtyId(props.spacePath, props.panel.id, "split", ptyId)
          }
        })
        .catch((err) => {
          console.error("Failed to create split pty:", err)
        })
    }
  })

  // Safety net: when Panel unmounts (tab close, panel remove, space switch),
  // kill split PTY if still alive. Main view PTY cleanup handled by view-registry onCleanup.
  onCleanup(() => {
    if (props.panel.splitPtyId) {
      sdk.client.pty.remove({ ptyID: props.panel.splitPtyId }).catch(() => {})
    }
  })

  // --- Session operations ---
  const sessionId = () => props.panel.boundSessionId
  const sessionInfo = () => sessionId() ? sessionStore.getSession(sessionId()!) : undefined

  const handleRename = () => {
    const id = sessionId()
    if (!id) return
    const current = sessionInfo()?.title ?? ""
    const next = prompt("重命名会话", current)
    if (!next || next === current) return
    const directory = props.panel.directory
    sessionStore.renameSession(id, next)
    void sdk.client.session.update({ sessionID: id, title: next, directory }).catch(() => {})
  }

  const handleCopyLink = () => {
    const id = sessionId()
    if (!id) return
    const url = `${window.location.origin}${window.location.pathname}#/${btoa(props.panel.directory)}/session/${id}`
    void navigator.clipboard.writeText(url).catch(() => {})
  }

  const handleOpenInNewPanel = () => {
    const id = sessionId()
    if (!id) return
    const newPanelId = wb.addPanel(props.spacePath)
    if (!newPanelId) return
    // Unbind from current panel first to avoid double-binding
    wb.unbindSessionFromPanel(props.spacePath, props.panel.id)
    sessionStore.bindPanel(id, newPanelId)
    wb.bindSessionToPanel(props.spacePath, newPanelId, id)
    wb.setActivePanel(props.spacePath, newPanelId)
  }

  const handleToggleSplit = () => {
    const spacePath = props.spacePath
    if (!spacePath) return
    const next = reconcileSplitTerminalState({
      open: !!props.panel.splitTerminal,
      ptyId: props.panel.splitPtyId,
    }, props.panel.splitTerminal ? "hide" : "show")
    setPanelSplitTerminal(spacePath, props.panel.id, next.open)
  }

  const handleClose = () => {
    const spacePath = props.spacePath
    if (!spacePath) return

    const slotState = props.panel.slotState

    // bound Panel: directly unbind session and make panel empty
    if (slotState === "bound") {
      const sessionId = props.panel.boundSessionId
      if (sessionId) sessionStore.unbindPanel(sessionId)
      wb.unbindSessionFromPanel(spacePath, props.panel.id)
      return
    }

    // open Panel: kill split PTY (main view PTY handled by view-registry onCleanup)
    if (slotState === "open") {
      if (props.panel.splitPtyId) {
        sdk.client.pty.remove({ ptyID: props.panel.splitPtyId }).catch(console.error)
        wb.setPanelPtyId(spacePath, props.panel.id, "split", undefined)
      }
      if (props.panel.splitTerminal) {
        wb.setPanelSplitTerminal(spacePath, props.panel.id, false)
      }
      if (props.panelCount <= 1) {
        wb.setPanelSlotState(spacePath, props.panel.id, "empty")
        return
      }
      wb.removePanel(spacePath, props.panel.id)
      return
    }

    // empty Panel: direct remove
    if (props.panelCount <= 1) return
    wb.removePanel(spacePath, props.panel.id)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const sessionId = e.dataTransfer?.getData("text/sessionId")
    const dragSpaceName = e.dataTransfer?.getData("text/spaceName")
    if (!sessionId || !dragSpaceName) return

    const spacePath = props.spacePath

    // Cross-space check
    if (dragSpaceName !== props.spaceName) {
      alert("会话不属于当前空间,请切换到对应空间 tab")
      return
    }

    const targetDrop = { targetSlotState: props.panel.slotState, sourceHasLiveBinding: false }
    if (!shouldAcceptSessionDrop(targetDrop)) {
      showToast({ title: t("workbench.panel.dropTargetOccupied") })
      return
    }

    // Try local session store first; if not found, it's a server session — create a local reference
    let session = sessionStore.getSession(sessionId)
    if (!session) {
      const projectPath = e.dataTransfer?.getData("text/projectPath") || props.panel.directory
      const sessionTitle = e.dataTransfer?.getData("text/sessionTitle") || sessionId
      session = sessionStore.ensureSessionReference(sessionId, dragSpaceName, projectPath, "chat", sessionTitle)
    }

    const boundPanel = session.boundPanelId && session.boundPanelId !== props.panel.id
      ? wb.spaceState(spacePath)?.panels.find((panel) => panel.id === session.boundPanelId)
      : undefined
    const sourceHasLiveBinding = !!boundPanel && boundPanel.boundSessionId === sessionId
    const sessionDrop = { targetSlotState: props.panel.slotState, sourceHasLiveBinding }
    if (!shouldAcceptSessionDrop(sessionDrop)) {
      const rejection = sessionDropRejection(sessionDrop)
      showToast({
        title: t(rejection === "target-occupied" ? "workbench.panel.dropTargetOccupied" : "workbench.panel.sessionAlreadyOpen"),
      })
      return
    }

    if (session.boundPanelId && !sourceHasLiveBinding) {
      sessionStore.unbindPanel(sessionId)
    }

    bindSessionToThisPanel()

    function bindSessionToThisPanel() {
      sessionStore.bindPanel(sessionId!, props.panel.id)
      wb.bindSessionToPanel(spacePath, props.panel.id, sessionId!)
    }
  }

  function DialogClosePanel(props: { panel: WorkbenchPanel; spacePath: string; panelCount: number }) {
    const session = () => sessionStore.getSession(props.panel.boundSessionId ?? "")
    const sessionTitle = () => session()?.title ?? "会话"

    const handleConfirm = () => {
      const spacePath = props.spacePath
      const sessionId = props.panel.boundSessionId
      if (sessionId) sessionStore.unbindPanel(sessionId)
      wb.unbindSessionFromPanel(spacePath, props.panel.id)

      // Kill split PTY if open
      if (props.panel.splitPtyId) {
        sdk.client.pty.remove({ ptyID: props.panel.splitPtyId }).catch(console.error)
      }
      if (props.panel.splitTerminal) {
        wb.setPanelSplitTerminal(spacePath, props.panel.id, false)
      }

      if (props.panelCount <= 1) {
        // Last panel: clear to empty instead of removing
        wb.setPanelSlotState(spacePath, props.panel.id, "empty")
        dialog.close()
        return
      }
      wb.removePanel(spacePath, props.panel.id)
      dialog.close()
    }

    return (
      <Dialog title="关闭会话" fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              确定要关闭会话 "{sessionTitle()}" 吗？
            </span>
            <span class="text-12-regular text-text-muted">
              关闭后会话将解绑，可在左侧会话列表中恢复
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              取消
            </Button>
            <Button variant="primary" size="large" onClick={handleConfirm}>
              确认关闭
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  let panelContainerRef: HTMLDivElement | undefined

  const splitHeight = () => props.panel.splitHeight ?? 180

  const handleSplitResizeStart = (e: MouseEvent) => {
    e.preventDefault()
    const container = panelContainerRef
    if (!container) return

    const startY = e.clientY
    const startHeight = splitHeight()
    const totalHeight = container.getBoundingClientRect().height

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY
      let newHeight = startHeight - deltaY

      // Constraints:
      // 1. Bottom split terminal min-height: 120px
      if (newHeight < 120) {
        newHeight = 120
      }

      // 2. Top area min-height: 200px
      const maxHeight = Math.max(120, totalHeight - 4 - 200)
      if (newHeight > maxHeight) {
        newHeight = maxHeight
      }

      const spacePath = props.spacePath
      if (spacePath) {
        wb.setPanelSplitHeight(spacePath, props.panel.id, newHeight)
      }
    }

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

  return (
    <div
      class={`flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-r border-v2-border-border-base last:border-r-0 transition-all duration-200 ${
        props.isActive ? "" : "opacity-90"
      }`}
      style={{ flex: props.panel.width }}
      onClick={props.onActivate}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      data-panel-id={props.panel.id}
      data-component="panel"
    >
      {/* Panel Header */}
      <div
        class={`flex h-7 shrink-0 items-center gap-1 px-2 border-b ${
          props.isActive
            ? "bg-v2-background-bg-deep border-v2-border-border-base"
            : "bg-v2-background-bg-base border-v2-border-border-base"
        }`}
      >
        {/* Status dot */}
        <span
          class="size-2 rounded-full shrink-0"
          classList={{
            "bg-green-500": props.panel.slotState === "bound",
            "bg-blue-400": props.panel.slotState === "open",
            "bg-v2-text-text-faint": props.panel.slotState === "empty",
          }}
        />

        {/* Title */}
        <span class="text-10-regular text-v2-text-text-faint truncate max-w-40 ml-0.5">
          {title()}
        </span>

        <div class="grow" />

        <Show when={props.panel.slotState === "bound"}>
          <IconButtonV2
            variant="ghost-muted"
            size="small"
            state={props.panel.splitTerminal ? "pressed" : undefined}
            icon={<IconV2 name="terminal" />}
            aria-label={t(props.panel.splitTerminal ? "workbench.panel.splitTerminal.hide" : "workbench.panel.splitTerminal.show")}
            title={t(props.panel.splitTerminal ? "workbench.panel.splitTerminal.hide" : "workbench.panel.splitTerminal.show")}
            onClick={(e: MouseEvent) => {
              e.stopPropagation()
              e.preventDefault()
              handleToggleSplit()
            }}
          />
        </Show>

        {/* View switch buttons */}
        <For each={headerViews()}>
          {(view) => {
            const active = props.panel.viewMode === view.id
            const spacePath = props.spacePath
            return (
              <button
                type="button"
                class={`px-1.5 py-0.5 rounded text-10-regular transition-colors ${
                  view.disabled
                    ? "text-v2-text-text-faint cursor-not-allowed"
                    : "cursor-pointer"
                } ${
                  active && !view.disabled
                    ? "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base"
                    : !view.disabled
                      ? "text-v2-text-text-muted hover:text-v2-text-text-base"
                      : ""
                }`}
                disabled={view.disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  if (view.disabled) return
                  wb.setPanelViewMode(spacePath, props.panel.id, view.id)
                }}
              >
                {view.label}
              </button>
            )
          }}
        </For>

        {/* Close Button */}
        <Show when={canRemove()}>
          <IconButtonV2
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="xmark-small" />}
            aria-label="关闭"
            onClick={(e: MouseEvent) => {
              e.stopPropagation()
              e.preventDefault()
              setTimeout(() => handleClose(), 0)
            }}
          />
        </Show>
      </div>

      {/* Main View Area */}
      <div
        class="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden bg-v2-background-bg-deep"
        ref={panelContainerRef}
      >
        <div class="flex-1 min-h-[200px] min-w-0 overflow-hidden relative">
          {/* 1. PanelLoader wrapper container (physically kept but visually toggled via hidden class) */}
          <div class="w-full h-full" classList={{ "hidden": props.panel.slotState !== "empty" }}>
            <PanelLoader panel={props.panel} spaceName={props.spaceName} spacePath={props.spacePath} />
          </div>

          {/* 2. Main Views (lazily mounted and hidden-toggled to preserve rendering state) */}
          <For each={["chat", "tui", "terminal", "context"]}>
            {(vm) => {
              const isMounted = () => mountedViews().has(vm)
              const viewDef = getView(vm)

              return (
                <Show when={isMounted() && viewDef}>
                  <div
                    class="absolute inset-0 flex flex-col min-h-0 min-w-0 overflow-hidden"
                    classList={{ "hidden": props.panel.slotState === "empty" || props.panel.viewMode !== vm }}
                  >
                    {(() => {
                      if (!viewDef) return null
                      const session = () => props.panel.boundSessionId
                        ? sessionStore.getSession(props.panel.boundSessionId)
                        : undefined
                      if (!viewDef.requiresSession) {
                        return viewDef.render({
                          panel: props.panel,
                          directory: props.panel.directory,
                          sdk,
                          spaceName: props.spaceName,
                          spacePath: props.spacePath,
                        })
                      }
                      return (
                        <Show
                          when={session()}
                          fallback={
                            <div class="flex flex-col items-center justify-center h-full gap-2 text-v2-text-text-muted bg-v2-background-bg-base">
                              <div class="animate-spin rounded-full h-4 w-4 border-2 border-v2-text-text-muted border-t-transparent" />
                              <span class="text-12-regular">正在恢复会话…</span>
                            </div>
                          }
                        >
                          {(loadedSession) => viewDef.render({
                            panel: props.panel,
                            session: loadedSession(),
                            directory: props.panel.directory,
                            sdk,
                            spaceName: props.spaceName,
                            spacePath: props.spacePath,
                          })}
                        </Show>
                      )
                    })()}
                  </div>
                </Show>
              )
            }}
          </For>
        </div>

        {/* Split Divider Handle */}
        <Show when={props.panel.splitTerminal}>
          <div
            class="h-1 hover:h-1.5 z-20 cursor-row-resize bg-v2-border-border-base hover:bg-v2-icon-icon-brand transition-all flex-shrink-0"
            onMouseDown={handleSplitResizeStart}
            title={t("workbench.panel.splitTerminal.resize")}
          />
        </Show>

        {/* Lower Split Terminal Area */}
        <Show when={props.panel.splitTerminal}>
          <div
            class="min-w-0 flex flex-col relative overflow-hidden bg-v2-background-bg-deep flex-shrink-0"
            style={{ height: `${splitHeight()}px` }}
          >
            <div class="flex h-6 shrink-0 items-center justify-between px-2 bg-v2-background-bg-base border-b border-v2-border-border-base text-10-medium text-v2-text-text-muted select-none">
              <span class="uppercase tracking-wider">{t("workbench.panel.splitTerminal.title")}</span>
              <button
                class="hover:text-v2-text-text-base cursor-pointer p-0.5 rounded transition-colors"
                onClick={handleToggleSplit}
              >
                ✕
              </button>
            </div>
            <div class="flex-1 min-h-0 min-w-0 overflow-hidden bg-v2-background-bg-deep">
              <Show
                when={props.panel.splitPtyId}
                fallback={
                  <div class="flex flex-col items-center justify-center h-full text-v2-text-text-muted gap-2">
                    <div class="animate-spin rounded-full h-4 w-4 border-2 border-v2-text-text-muted border-t-transparent" />
                    <span class="text-10-regular">{t("workbench.panel.splitTerminal.loading")}</span>
                  </div>
                }
              >
                {(ptyId) => (
                  <Terminal
                    pty={{ id: ptyId(), title: "split terminal", titleNumber: 3 }}
                    class="w-full h-full"
                    noPadding={true}
                    onConnectError={() => setPanelPtyId(props.spacePath, props.panel.id, "split", undefined)}
                  />
                )}
              </Show>
            </div>
          </div>
        </Show>
      </div>
      <style>
        {`
          div[data-component="panel"] ::-webkit-scrollbar,
          div[data-component="panel"]::-webkit-scrollbar {
            display: none !important;
            width: 0 !important;
            height: 0 !important;
          }
        `}
      </style>
    </div>
  )
}
