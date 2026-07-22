import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { Show, createEffect, For, createSignal, on } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useNotification } from "@/context/notification"
import { Terminal } from "@/components/terminal"
import { useWorkbenchState } from "../view-store"
import { useSessionStore } from "../session-store"
import { useWorkbenchActions } from "../workbench-actions"
import { scopeFromTab } from "../workbench-scope"
import { getView } from "../view-registry"
import { PanelLoader } from "./panel-loader"
import { reconcileMountedViews } from "./panel-mounted-views"
import { reconcileSplitTerminalState, splitTerminalTitle } from "./panel-split-terminal"
import { shouldRestoreBoundSession, isSessionNotFound } from "./panel-session-lifecycle"
import { sanitizeDirectory } from "../directory-utils"
import { reportWorkbenchError } from "../workbench-error"
import { DialogOverwritePanel, DialogCrossSpaceWarning } from "./session-tree-dialogs"
import { handlePanelDrop, startSplitResize } from "./panel-services"
import { PanelHeader } from "./panel-header"
import type { WorkbenchPanel, PanelMode } from "../view-store"

function isInteractiveInputElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true
  if (target.closest('[contenteditable="true"], [role="textbox"], textarea, input, .xterm, [data-component="terminal"]')) return true
  return false
}

export function Panel(props: {
  panel: WorkbenchPanel
  spaceName: string
  spacePath: string
  isActive: boolean
  panelCount: number
  panelIndex?: number
  onActivate: () => void
  onModeChange: (mode: PanelMode) => void
}) {
  const language = useLanguage()
  const t: typeof language.t = (key, params) => language.t(key, params)
  const sdk = useSDK()
  const wb = useWorkbenchState()
  const actions = useWorkbenchActions()
  const { setPanelSplitTerminal } = wb
  const sessionStore = useSessionStore()
  const dialog = useDialog()
  const notification = useNotification()
  const panelScope = () => scopeFromTab({ name: props.spaceName, path: props.spacePath })

  // 用户正在查看此面板绑定的会话时，清除其未读蓝点。
  // 需同时满足：面板绑定了会话、面板是其空间的激活面板、所在空间是当前激活 Tab。
  // 订阅 unseenCount 以确保后台完成新回复后在激活视图中即时清除未读。
  createEffect(() => {
    const sessionID = props.panel.boundSessionId
    if (!sessionID) return
    if (!props.isActive) return
    if (wb.activeTabPath !== props.spacePath) return
    if (notification.session.unseenCount(sessionID) > 0) {
      notification.session.markViewed(sessionID)
    }
  })



  const [mountedViews, setMountedViews] = createSignal(new Set<string>())
  const [terminalTitle, setTerminalTitle] = createSignal<string>()
  const [isTerminalMaximized, setIsTerminalMaximized] = createSignal(false)

  createEffect(() => {
    if (!props.panel.splitTerminal) {
      setIsTerminalMaximized(false)
    }
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

  const directoryHealth = () => {
    if (props.panel.slotState !== "bound") return "healthy" as const
    const session = sessionStore.getSession(props.panel.boundSessionId ?? "")
    return session?.directoryHealth ?? "healthy" as const
  }
  const isDirUnhealthy = () => directoryHealth() !== "healthy"
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
    void actions.refreshSession({
      scope: panelScope(),
      panelID: props.panel.id,
      sessionID,
      directory: props.panel.directory,
    })
      .then((result) => {
        if (result.unavailableReason === "archived") {
          wb.setStatusMessage(t("workbench.status.restoredSessionArchived"))
        }
        if (result.unavailableReason === "child") {
          wb.setStatusMessage(t("workbench.status.restoredSessionChild"))
        }
      })
      .catch((error) => {
        if (isSessionNotFound(error)) {
          // Session no longer exists on the sidecar (database reset, sidecar
          // restart with fresh DB, or external deletion). Unbind the panel so
          // it returns to a clean state instead of retrying on every render.
          void actions.unbindSession({ scope: panelScope(), panelID: props.panel.id })
            .then(() => wb.setStatusMessage(t("workbench.status.boundSessionGone")))
            .catch((err) => reportWorkbenchError("unbind stale session", err))
          return
        }
        reportWorkbenchError("restore bound session", error)
      })
      .finally(() => {
        restoringSessionIDs.delete(sessionID)
      })
  })

  createEffect(() => {
    const splitOpen = props.panel.splitTerminal
    const directory = props.panel.directory
    const existingId = props.panel.splitPtyId

    if (splitOpen) {
      if (!existingId) setTerminalTitle(undefined)
      void actions.ensurePanelPty({
        scope: panelScope(),
        panelID: props.panel.id,
        kind: "split",
        create: async () => {
          // Defense-in-depth: reject path-traversal / relative cwd before
          // asking the backend to spawn a PTY in it. The directory normally
          // comes from server projections or drag payloads, neither of which
          // should ever contain ".." or be relative — if they do, refuse
          // rather than forward the unsafe value.
          const cwd = sanitizeDirectory(directory)
          if (cwd === undefined) throw new Error(`Refusing to create PTY with unsafe directory: ${directory}`)
          const res = await sdk.client.pty.create({
            cwd,
            title: t("terminal.title"),
          })
          if (!res.data?.id) throw new Error("No PTY ID returned")
          return res.data.id
        },
      }).then((result) => {
        if (result.status === "stale" || !props.panel.splitTerminal) return
      }).catch((err) => reportWorkbenchError("create split pty", err))
    }
  })
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
    void actions.closeSplitTerminal({ scope: panelScope(), panelID: props.panel.id })
      .then(() => setTerminalTitle(undefined))
      .catch((error) => reportWorkbenchError("close split terminal", error))
  }

  const handleDrop = (e: DragEvent) => {
    handlePanelDrop(e, {
      panel: props.panel,
      spaceName: props.spaceName,
      spacePath: props.spacePath,
      wb,
      actions,
      panelScope,
      dialog,
      t,
      showToast,
    }, (panelIndex, onConfirm) => {
      void dialog.show(() => (
        <DialogOverwritePanel
          panelIndex={panelIndex}
          onConfirm={() => {
            void onConfirm()
              .then(() => dialog.close())
              .catch((error) => reportWorkbenchError("replace session", error))
          }}
        />
      ))
    }, (dragSpace, targetSpace) => {
      void dialog.show(() => (
        <DialogCrossSpaceWarning dragSpace={dragSpace} targetSpace={targetSpace} />
      ))
    })
  }

  let panelContainerRef: HTMLDivElement | undefined

  const splitHeight = () => props.panel.splitHeight ?? 180

  const handleSplitResizeStart = (e: MouseEvent) => {
    startSplitResize(e, panelContainerRef, splitHeight(), (finalHeight) => {
      const spacePath = props.spacePath
      if (spacePath) {
        wb.setPanelSplitHeight(spacePath, props.panel.id, finalHeight)
      }
    })
  }

  return (
    <div
      class="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-v2-border-border-base opacity-100 transition-[flex] duration-200"
      style={{ flex: props.panel.width }}
      onMouseDown={(e: MouseEvent) => {
        if (!props.isActive && isInteractiveInputElement(e.target)) {
          props.onActivate()
        }
      }}
      onClick={() => {
        if (!props.isActive) {
          props.onActivate()
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      data-panel-id={props.panel.id}
      data-component="panel"
    >
      <PanelHeader
        panel={props.panel}
        spaceName={props.spaceName}
        spacePath={props.spacePath}
        isActive={props.isActive}
        panelCount={props.panelCount}
        panelIndex={props.panelIndex}
        onToggleSplit={handleToggleSplit}
      />

      {/* Main View Area */}
      <div
        class="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden bg-v2-background-bg-deep"
        style={{ isolation: "isolate", transform: "translateZ(0)" }}
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
        <div
          class="flex-1 min-h-[200px] min-w-0 overflow-hidden relative"
          classList={{ "hidden": isTerminalMaximized() }}
        >
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
                    style={{
                      display: props.panel.slotState !== "empty" && props.panel.viewMode === vm ? "flex" : "none",
                      visibility: props.panel.slotState !== "empty" && props.panel.viewMode === vm ? "visible" : "hidden",
                    }}
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
                              <div class="workbench-spinner rounded-full h-4 w-4 border-2 border-v2-text-text-muted border-t-transparent" />
                              <span class="text-12-regular">正在恢复会话…</span>
                            </div>
                          }
                        >
                          {viewDef.render({
                            panel: props.panel,
                            session: session()!,
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
        <Show when={props.panel.splitTerminal && !isTerminalMaximized()}>
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
              classList={{
                "hidden": !props.panel.splitTerminal,
                "flex-1 h-full": isTerminalMaximized(),
              }}
              style={{ height: isTerminalMaximized() ? undefined : `${splitHeight()}px` }}
              data-split-terminal
            >
              <div
                class="flex h-6 shrink-0 items-center justify-between px-2 bg-v2-background-bg-base border-b border-v2-border-border-base text-10-medium text-v2-text-text-muted select-none cursor-pointer"
                onDblClick={(e) => {
                  e.stopPropagation()
                  setIsTerminalMaximized((prev) => !prev)
                }}
                title={t(isTerminalMaximized() ? "workbench.panel.splitTerminal.restore" : "workbench.panel.splitTerminal.maximize")}
              >
                <span class="tracking-wider flex items-center gap-1.5">
                  {splitTitle()}
                </span>
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    class="flex items-center justify-center p-0.5 rounded hover:bg-v2-overlay-simple-overlay-hover transition-colors cursor-pointer"
                    title={t(isTerminalMaximized() ? "workbench.panel.splitTerminal.restore" : "workbench.panel.splitTerminal.maximize")}
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsTerminalMaximized((prev) => !prev)
                    }}
                    onDblClick={(e) => e.stopPropagation()}
                  >
                    <Show
                      when={isTerminalMaximized()}
                      fallback={
                        <svg class="size-3 shrink-0 text-v2-text-text-muted hover:text-v2-text-text-base" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M10 2h4v4" />
                          <path d="M14 2L9.5 6.5" />
                          <path d="M6 14H2v-4" />
                          <path d="M2 14l4.5-4.5" />
                        </svg>
                      }
                    >
                      <svg class="size-3 shrink-0 text-v2-text-text-muted hover:text-v2-text-text-base" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 6h-4V2" />
                        <path d="M10 6l4.5-4.5" />
                        <path d="M2 10h4v4" />
                        <path d="M6 10l-4.5 4.5" />
                      </svg>
                    </Show>
                  </button>
                  <button
                    type="button"
                    class="flex items-center justify-center p-0.5 rounded hover:bg-v2-overlay-simple-overlay-hover transition-colors cursor-pointer"
                    title={t("workbench.panel.splitTerminal.hide")}
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsTerminalMaximized(false)
                      handleCloseSplit()
                    }}
                    onDblClick={(e) => e.stopPropagation()}
                  >
                    <svg class="size-3 shrink-0 text-v2-text-text-muted hover:text-v2-text-text-base" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              </div>
              <div class="flex-1 min-h-0 min-w-0 overflow-hidden bg-v2-background-bg-deep">
                <Terminal
                  pty={{ id: ptyId, title: splitTitle(), titleNumber: 3 }}
                  class="w-full h-full"
                  noPadding={true}
                  onConnectError={() => {
                    void actions.recoverPanelPty({
                      scope: panelScope(),
                      panelID: props.panel.id,
                      kind: "split",
                      ptyID: ptyId,
                    }).then((result) => {
                      if (result.status === "committed") setTerminalTitle(undefined)
                    }).catch((e) => reportWorkbenchError("recover split pty", e))
                  }}
                  onTitleChange={(title) => setTerminalTitle(title)}
                  onClose={() => {
                    void actions.recoverPanelPty({
                      scope: panelScope(),
                      panelID: props.panel.id,
                      kind: "split",
                      ptyID: ptyId,
                    }).then((result) => {
                      if (result.status === "committed") setTerminalTitle(undefined)
                    }).catch((e) => reportWorkbenchError("recover split pty", e))
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
