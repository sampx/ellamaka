import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { Show, createEffect, onCleanup, For, createSignal, on, batch } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { Terminal } from "@/components/terminal"
import { useWorkbenchState } from "../view-store"
import { useSessionStore } from "../session-store"
import { ptyManager, ptyReferences } from "../pty-manager"
import { getView, listViews } from "../view-registry"
import { PanelLoader } from "./panel-loader"
import { getPanelHeaderViews } from "./panel-header-views"
import { reconcileMountedViews } from "./panel-mounted-views"
import { reconcileSplitTerminalState, splitTerminalTitle } from "./panel-split-terminal"
import { sessionDropRejection, shouldAcceptSessionDrop, shouldRestoreBoundSession } from "./panel-session-lifecycle"
import type { WorkbenchPanel, PanelMode } from "../view-store"

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
  const [terminalTitle, setTerminalTitle] = createSignal<string>()
  let unmounted = false
  onCleanup(() => {
    unmounted = true
  })

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
    const parts = props.panel.id.split("-")
    return `Panel #${parts[parts.length - 1] ?? props.panel.id}`
  }
  const directoryHealth = () => {
    if (props.panel.slotState !== "bound") return "healthy" as const
    const session = sessionStore.getSession(props.panel.boundSessionId ?? "")
    return session?.directoryHealth ?? "healthy" as const
  }
  const isDirUnhealthy = () => directoryHealth() !== "healthy"
  const headerViews = () => getPanelHeaderViews(listViews(), props.panel.slotState)
  const splitTitle = () => splitTerminalTitle(terminalTitle(), t("terminal.title"))
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


  // Split terminal PTY is managed by panel.tsx via ptyManager
  createEffect(() => {
    const splitOpen = props.panel.splitTerminal
    const directory = props.panel.directory
    const spacePath = props.spacePath
    const existingId = props.panel.splitPtyId

    if (spacePath === undefined || spacePath === null) return

    if (splitOpen) {
      if (!existingId) setTerminalTitle(undefined)
      ptyManager.ensure({
        spacePath,
        panelId: props.panel.id,
        kind: "split",
        existingPtyId: existingId,
        sdk,
        createFn: async () => {
          const res = await sdk.client.pty.create({
            cwd: directory,
            title: t("terminal.title"),
          })
          if (!res.data?.id) throw new Error("No PTY ID returned")
          return res.data.id
        }
      }).then((id) => {
        if (unmounted || !props.panel.splitTerminal) return
        if (id !== existingId) {
          wb.setPanelPtyId(spacePath, props.panel.id, "split", id)
        }
      }).catch((err) => {
        console.error("Failed to create split pty:", err)
      })
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
    wb.bindSessionToPanel(props.spacePath, newPanelId, id)
    wb.setActivePanel(props.spacePath, newPanelId)
  }

  const handleToggleSplit = () => {
    const spacePath = props.spacePath
    if (spacePath === undefined || spacePath === null) return
    const next = reconcileSplitTerminalState({
      open: !!props.panel.splitTerminal,
      ptyId: props.panel.splitPtyId,
    }, props.panel.splitTerminal ? "hide" : "show")
    setPanelSplitTerminal(spacePath, props.panel.id, next.open)
  }

  const handleCloseSplit = () => {
    const spacePath = props.spacePath
    if (spacePath === undefined || spacePath === null) return
    const ptyId = props.panel.splitPtyId
    const next = reconcileSplitTerminalState({ open: !!props.panel.splitTerminal, ptyId }, "teardown")
    batch(() => {
      setPanelSplitTerminal(spacePath, props.panel.id, next.open)
      setPanelPtyId(spacePath, props.panel.id, "split", next.ptyId)
      setTerminalTitle(undefined)
    })
    void ptyManager.disposePty({
      spacePath,
      panelId: props.panel.id,
      kind: "split",
      knownPtyId: ptyId,
      sdk,
    })
  }

  const handleClose = () => {
    const spacePath = props.spacePath
    if (spacePath === undefined || spacePath === null) return

    const slotState = props.panel.slotState

    // bound Panel: unbind session, dispose PTYs and optionally remove panel
    if (slotState === "bound") {
      if (props.panelCount > 1) {
        wb.removePanel(spacePath, props.panel.id)
        return
      }
      wb.unbindSessionFromPanel(spacePath, props.panel.id)
      void ptyManager.disposePanel(spacePath, props.panel.id, sdk, ptyReferences(props.panel))
      return
    }

    // empty Panel: direct remove if multiple exist
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

    const sessionBoundPanelId = wb.boundPanelIdForSession(sessionId)
    const boundPanel = sessionBoundPanelId && sessionBoundPanelId !== props.panel.id
      ? wb.spaceState(spacePath)?.panels.find((panel) => panel.id === sessionBoundPanelId)
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

    bindSessionToThisPanel()

    function bindSessionToThisPanel() {
      wb.bindSessionToPanel(spacePath, props.panel.id, sessionId!)
    }
  }

  function DialogClosePanel(props: { panel: WorkbenchPanel; spacePath: string; panelCount: number }) {
    const session = () => sessionStore.getSession(props.panel.boundSessionId ?? "")
    const sessionTitle = () => session()?.title ?? "会话"

    const handleConfirm = () => {
      const spacePath = props.spacePath
      if (props.panelCount > 1) {
        wb.removePanel(spacePath, props.panel.id)
        dialog.close()
        return
      }

      wb.unbindSessionFromPanel(spacePath, props.panel.id)
      void ptyManager.disposePanel(spacePath, props.panel.id, sdk, ptyReferences(props.panel))
      wb.setPanelSplitTerminal(spacePath, props.panel.id, false)
      wb.setPanelPtyId(spacePath, props.panel.id, "split", undefined)

      if (props.panelCount <= 1) {
        // Last panel: clear to empty instead of removing
        wb.setPanelSlotState(spacePath, props.panel.id, "empty")
        dialog.close()
        return
      }
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
      class="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-v2-border-border-base opacity-100 transition-all duration-200"
      style={{ flex: props.panel.width }}
      onClick={props.onActivate}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      data-panel-id={props.panel.id}
      data-component="panel"
    >
      {/* Panel Header */}
      <div
        class="flex h-7 shrink-0 items-center gap-1 px-2 border-b relative transition-colors duration-200"
        classList={{
          "bg-blue-50/80 border-blue-200 dark:bg-blue-950/40 dark:border-blue-900/50": props.isActive,
          "bg-v2-background-bg-base border-v2-border-border-base": !props.isActive,
        }}
      >
        <Show when={props.isActive}>
          <div class="absolute top-0 inset-x-0 h-[2px] bg-v2-border-border-brand-strong" />
        </Show>

        {/* Status dot */}
        <span
          class="size-2 rounded-full shrink-0"
          classList={{
            "bg-green-500": props.panel.slotState === "bound",
            "bg-v2-text-text-faint": props.panel.slotState === "empty",
          }}
        />

        {/* Title */}
        <span
          class="truncate max-w-40 ml-0.5 transition-colors duration-200"
          classList={{
            "text-11-bold text-v2-text-text-strong font-semibold": props.isActive,
            "text-10-regular text-v2-text-text-muted": !props.isActive,
          }}
        >
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
            const spacePath = props.spacePath
            return (
              <button
                type="button"
                class="px-1.5 py-0.5 rounded text-10-regular transition-colors"
                classList={{
                  "text-v2-text-text-faint cursor-not-allowed": view.disabled,
                  "cursor-pointer": !view.disabled,
                  "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base": props.panel.viewMode === view.id && !view.disabled,
                  "text-v2-text-text-muted hover:text-v2-text-text-base": props.panel.viewMode !== view.id && !view.disabled,
                }}
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
        <Show when={isDirUnhealthy()}>
          <div class="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-11-regular text-amber-700 dark:text-amber-400 shrink-0">
            <svg class="size-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 9v2m0 4h.01M12 3l9.66 16.5H2.34L12 3z" />
            </svg>
            <span>工作目录{directoryHealth() === "missing" ? "不存在" : "不可用"} — 终端和 Shell 操作不可用，聊天历史仍可查看</span>
          </div>
        </Show>
        <div class="flex-1 min-h-[200px] min-w-0 overflow-hidden relative">
          {/* 1. PanelLoader wrapper container (physically kept but visually toggled via hidden class) */}
          <div class="w-full h-full" classList={{ "hidden": props.panel.slotState !== "empty" }}>
            <PanelLoader panel={props.panel} spaceName={props.spaceName} spacePath={props.spacePath} />
          </div>

          {/* 2. Main Views (lazily mounted and hidden-toggled to preserve rendering state) */}
          <For each={["chat", "tui", "context"]}>
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
            class="h-px z-20 cursor-row-resize bg-v2-border-border-base hover:bg-v2-icon-icon-brand/30 transition-colors flex-shrink-0"
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
              <span class="tracking-wider">{splitTitle()}</span>
              <button
                class="hover:text-v2-text-text-base cursor-pointer p-0.5 rounded transition-colors"
                onClick={handleCloseSplit}
              >
                ✕
              </button>
            </div>
            <div class="flex-1 min-h-0 min-w-0 overflow-hidden bg-v2-background-bg-deep">
              <Show
                when={props.panel.splitPtyId}
                keyed
                fallback={
                  <div class="flex flex-col items-center justify-center h-full text-v2-text-text-muted gap-2">
                    <div class="animate-spin rounded-full h-4 w-4 border-2 border-v2-text-text-muted border-t-transparent" />
                    <span class="text-10-regular">{t("workbench.panel.splitTerminal.loading")}</span>
                  </div>
                }
              >
                {(ptyId) => (
                  <Terminal
                    pty={{ id: ptyId, title: splitTitle(), titleNumber: 3 }}
                    class="w-full h-full"
                    noPadding={true}
                    onConnectError={() => {
                      setTerminalTitle(undefined)
                      setPanelPtyId(props.spacePath, props.panel.id, "split", undefined)
                    }}
                    onTitleChange={(title) => setTerminalTitle(title)}
                    onClose={() => {
                      batch(() => {
                        setTerminalTitle(undefined)
                        setPanelPtyId(props.spacePath, props.panel.id, "split", undefined)
                        setPanelSplitTerminal(props.spacePath, props.panel.id, false)
                        ptyManager.delete(props.spacePath, props.panel.id, "split")
                      })
                    }}
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
