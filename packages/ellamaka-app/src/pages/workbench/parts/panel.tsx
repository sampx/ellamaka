import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { Show, createEffect, onCleanup, For, createSignal, on, batch, onMount, createMemo } from "solid-js"
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
import { disconnectRecovery, sessionDropRejection, shouldAcceptSessionDrop, shouldRestoreBoundSession } from "./panel-session-lifecycle"
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
  const t = (k: string, params?: Record<string, string | number | boolean>) => language.t(k as Parameters<typeof language.t>[0], params)
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
      () => [props.panel.boundSessionId, props.panel.slotState, props.panel.viewMode, props.panel.tuiPtyId] as const,
      ([nextBoundSessionId, slotState, viewMode, tuiPtyId], previous) => {
        setMountedViews((prev) => reconcileMountedViews(prev, {
          prevBoundSessionId: previous?.[0],
          nextBoundSessionId,
          slotState,
          viewMode,
          hasTuiPtyId: !!tuiPtyId,
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
  const headerViews = () => getPanelHeaderViews(listViews(), props.panel.slotState, props.panel.tuiPtyId)
  const splitTitle = () => splitTerminalTitle(terminalTitle(), t("terminal.title"))
  const restoringSessionIDs = new Set<string>()
  const hasOpenSplitPty = createMemo(() => !!props.panel.splitPtyId)

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
        directory,
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

    let inputEl: HTMLInputElement | undefined
    const [val, setVal] = createSignal(current)

    dialog.show(() => (
      <Dialog title={t("workbench.tree.rename") || "重命名会话"} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[320px]">
          <div class="flex flex-col gap-2">
            <input
              ref={inputEl}
              type="text"
              class="w-full px-3 py-1.5 text-12-regular text-text-strong bg-v2-background-bg-deep border border-v2-border-border-base rounded-md focus:outline-none focus:border-v2-border-border-brand-strong"
              value={val()}
              onInput={(e) => setVal(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const trimmed = val().trim()
                  if (trimmed && trimmed !== current) {
                    const directory = props.panel.directory
                    sessionStore.renameSession(id, trimmed)
                    void sdk.client.session.update({ sessionID: id, title: trimmed, directory }).catch(() => {})
                  }
                  dialog.close()
                }
                if (e.key === "Escape") dialog.close()
              }}
            />
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {t("common.cancel") || "取消"}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                const trimmed = val().trim()
                if (trimmed && trimmed !== current) {
                  const directory = props.panel.directory
                  sessionStore.renameSession(id, trimmed)
                  void sdk.client.session.update({ sessionID: id, title: trimmed, directory }).catch(() => {})
                }
                dialog.close()
              }}
            >
              {t("common.confirm") || "确认"}
            </Button>
          </div>
        </div>
      </Dialog>
    ))

    setTimeout(() => {
      inputEl?.focus()
      inputEl?.select()
    }, 50)
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

  function DialogOverwritePanel(props: {
    panelIndex: number
    onConfirm: () => void
  }) {
    return (
      <Dialog title={t("workbench.panel.overwriteTitle") || "覆盖会话窗口"} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[320px]">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {t("workbench.panel.overwriteConfirmText", { index: String(props.panelIndex) }) || `确定要覆盖面板 #${props.panelIndex} 的当前会话吗？`}
            </span>
            <span class="text-12-regular text-text-muted">
              {t("workbench.panel.overwriteConfirmHint") || "覆盖后原有会话将自动解绑，您可以在左侧会话列表中随时重新恢复。"}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {t("common.cancel") || "取消"}
            </Button>
            <Button variant="primary" size="large" onClick={props.onConfirm}>
              {t("common.confirm") || "确认"}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  function DialogCrossSpaceWarning(props: { dragSpace: string; targetSpace: string }) {
    return (
      <Dialog title={t("common.warning") || "空间不匹配提示"} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[320px]">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {t("workbench.panel.crossSpaceWarningText", { dragSpace: props.dragSpace, targetSpace: props.targetSpace }) ||
                `该会话属于空间 "${props.dragSpace}"，无法装载到 "${props.targetSpace}" 中。`}
            </span>
            <span class="text-12-regular text-text-muted">
              {t("workbench.panel.crossSpaceWarningHint") || "请先在左侧切换到对应的空间进行操作。"}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="primary" size="large" onClick={() => dialog.close()}>
              {t("common.confirm") || "确认"}
            </Button>
          </div>
        </div>
      </Dialog>
    )
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
      dialog.show(() => (
        <DialogCrossSpaceWarning
          dragSpace={dragSpaceName}
          targetSpace={props.spaceName}
        />
      ))
      return
    }

    if (props.panel.boundSessionId === sessionId) {
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

    if (sourceHasLiveBinding) {
      showToast({ title: t("workbench.panel.sessionAlreadyOpen") })
      return
    }

    const loadSessionIntoPanel = () => {
      if (props.panel.slotState === "bound") {
        void ptyManager.disposePanel(spacePath, props.panel.id, sdk, ptyReferences(props.panel))
        wb.setPanelPtyId(spacePath, props.panel.id, "tui", undefined)
        wb.setPanelPtyId(spacePath, props.panel.id, "term", undefined)
        wb.setPanelPtyId(spacePath, props.panel.id, "split", undefined)
        wb.setPanelSplitTerminal(spacePath, props.panel.id, false)
        wb.unbindSessionFromPanel(spacePath, props.panel.id)
      }
      wb.bindSessionToPanel(spacePath, props.panel.id, sessionId!)
      wb.setPanelViewMode(spacePath, props.panel.id, "chat")
      wb.setActivePanel(spacePath, props.panel.id)
    }

    if (props.panel.slotState === "bound") {
      const panelsList = wb.spaceState(spacePath)?.panels ?? []
      const idx = panelsList.findIndex((p) => p.id === props.panel.id)
      dialog.show(() => (
        <DialogOverwritePanel
          panelIndex={idx !== -1 ? idx + 1 : 1}
          onConfirm={() => {
            loadSessionIntoPanel()
            dialog.close()
          }}
        />
      ))
    } else {
      loadSessionIntoPanel()
    }
  }

  function DialogClosePanel(props: { panel: WorkbenchPanel; spacePath: string; panelCount: number }) {
    const session = () => sessionStore.getSession(props.panel.boundSessionId ?? "")
    const sessionTitle = () => session()?.title ?? t("workbench.panelClose.title")

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
        wb.resetPanelWidths(spacePath)
        dialog.close()
        return
      }
    }

    return (
      <Dialog title={t("workbench.panelClose.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[380px]">
          <div class="flex flex-col gap-3">
            <span class="text-14-medium text-v2-text-text-strong">
              {t("workbench.panelClose.confirm", { title: sessionTitle() })}
            </span>
            <div class="flex flex-col gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-deep p-3 text-12-regular text-v2-text-text-muted">
              <span class="text-12-medium text-v2-text-text-base mb-1">
                {t("workbench.panelClose.desc")}
              </span>
              <span>
                {t("workbench.panelClose.consequenceSession")}
              </span>
              <span class="text-amber-500/95 dark:text-amber-400/90 font-medium">
                {t("workbench.panelClose.consequenceTerminal")}
              </span>
            </div>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={handleConfirm}>
              {t("workbench.panelClose.confirmButton")}
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
            style={{ color: hasOpenSplitPty() ? "var(--v2-icon-icon-accent)" : undefined }}
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
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-10-regular transition-colors"
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
                <span>{view.label}</span>
                <Show when={view.hasOpenTui}>
                  <span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent" />
                </Show>
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
              if (props.panel.slotState === "bound") {
                dialog.show(() => (
                  <DialogClosePanel
                    panel={props.panel}
                    spacePath={props.spacePath}
                    panelCount={props.panelCount}
                  />
                ))
              } else {
                setTimeout(() => handleClose(), 0)
              }
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

        {/* Lower Split Terminal Area — kept mounted when collapsed to preserve WebSocket subscriber */}
        <Show when={props.panel.splitPtyId} keyed>
          {(ptyId) => (
            <div
              class="min-w-0 flex flex-col relative overflow-hidden bg-v2-background-bg-deep flex-shrink-0"
              classList={{ "hidden": !props.panel.splitTerminal }}
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
                <Terminal
                  pty={{ id: ptyId, title: splitTitle(), titleNumber: 3 }}
                  class="w-full h-full"
                  noPadding={true}
                  onConnectError={() => {
                    sdk.client.pty.get({ ptyID: ptyId }).then(() => {
                      // PTY still alive — keep state, Terminal will retry
                    }).catch(() => {
                      setTerminalTitle(undefined)
                      setPanelPtyId(props.spacePath, props.panel.id, "split", undefined)
                    })
                  }}
                  onTitleChange={(title) => setTerminalTitle(title)}
                  onClose={() => {
                    sdk.client.pty.get({ ptyID: ptyId }).then(() => {
                      const action = disconnectRecovery({ ptyAlive: true })
                      if (action === "reconnect") return
                    }).catch(() => {
                      const action = disconnectRecovery({ ptyAlive: false })
                      if (action === "reconnect") return
                      batch(() => {
                        setTerminalTitle(undefined)
                        setPanelPtyId(props.spacePath, props.panel.id, "split", undefined)
                        setPanelSplitTerminal(props.spacePath, props.panel.id, false)
                        ptyManager.delete(props.spacePath, props.panel.id, "split")
                      })
                    })
                  }}
                />
              </div>
            </div>
          )}
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
