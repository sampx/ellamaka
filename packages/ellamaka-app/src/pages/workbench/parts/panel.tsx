import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { Show, createEffect, For, createSignal, on } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { Terminal } from "@/components/terminal"
import { useWorkbenchState } from "../view-store"
import { useSessionStore } from "../session-store"
import { useWorkbenchActions } from "../workbench-actions"
import { scopeFromTab } from "../workbench-scope"
import { getView } from "../view-registry"
import { PanelLoader } from "./panel-loader"
import { reconcileMountedViews } from "./panel-mounted-views"
import { reconcileSplitTerminalState, splitTerminalTitle } from "./panel-split-terminal"
import { shouldRestoreBoundSession } from "./panel-session-lifecycle"
import { sanitizeDirectory } from "../directory-utils"
import { reportWorkbenchError } from "../workbench-error"
import { DialogOverwritePanel, DialogCrossSpaceWarning } from "./session-tree-dialogs"
import { handlePanelDrop, startSplitResize } from "./panel-services"
import { PanelHeader } from "./panel-header"
import type { WorkbenchPanel, PanelMode } from "../view-store"

export function Panel(props: {
  panel: WorkbenchPanel
  spaceName: string
  spacePath: string
  isActive: boolean
  panelCount: number
  onActivate: () => void
  onModeChange: (mode: PanelMode) => void
}) {
  const language = useLanguage()
  const t = (k: string, params?: Record<string, string | number | boolean>) => language.t(k as Parameters<typeof language.t>[0], params)
  const sdk = useSDK()
  const wb = useWorkbenchState()
  const actions = useWorkbenchActions()
  const { setPanelSplitTerminal } = wb
  const sessionStore = useSessionStore()
  const dialog = useDialog()
  const panelScope = () => scopeFromTab({ name: props.spaceName, path: props.spacePath })



  const [mountedViews, setMountedViews] = createSignal(new Set<string>())
  const [terminalTitle, setTerminalTitle] = createSignal<string>()
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
      .catch((error) => reportWorkbenchError("restore bound session", error))
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

  const handleClose = () => {
    const spacePath = props.spacePath
    if (spacePath === undefined || spacePath === null) return
    void actions.closePanel({ scope: panelScope(), panelID: props.panel.id }).catch((error) =>
      reportWorkbenchError("close panel", error),
    )
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
      class="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-v2-border-border-base opacity-100 transition-all duration-200"
      style={{ flex: props.panel.width }}
      onClick={props.onActivate}
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
        onToggleSplit={handleToggleSplit}
      />

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
              data-split-terminal
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
