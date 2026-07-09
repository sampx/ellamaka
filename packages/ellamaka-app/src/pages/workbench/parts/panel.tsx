import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Show, createEffect, onCleanup, For } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { Terminal } from "@/components/terminal"
import { useWorkbenchState } from "../view"
import { useSessionStore } from "../session-store"
import { getView, listViews } from "../view-registry"
import { PanelLoader } from "./panel-loader"
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
  const headerViews = () => {
    const all = listViews()
    if (props.panel.slotState === "empty") return []
    if (props.panel.slotState === "open") {
      return all.map((v) => ({ ...v, disabled: !v.availableInOpen }))
    }
    return all
      .filter((v) => v.requiresSession || v.id === "terminal")
      .map((v) => ({ ...v, disabled: false }))
  }
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
  const isArchived = () => sessionInfo()?.status === "archived"

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

  const handleArchiveToggle = () => {
    const id = sessionId()
    if (!id) return
    const directory = props.panel.directory
    const archive = !isArchived()
    const archived = archive ? Date.now() : undefined
    void sdk.client.session.update({ sessionID: id, time: { archived }, directory })
      .then(() => {
        sessionStore.archiveSession(id, archive)
        if (archive) {
          sessionStore.unbindPanel(id)
          wb.unbindSessionFromPanel(props.spacePath, props.panel.id)
        }
      })
      .catch(() => {})
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

  const handleDeleteSession = () => {
    const id = sessionId()
    if (!id) return
    const session = sessionInfo()
    if (!confirm(`确定要删除会话 "${session?.title ?? id}" 吗？此操作不可撤销。`)) return
    const directory = props.panel.directory
    void sdk.client.session.delete({ sessionID: id, directory })
      .then(() => {
        sessionStore.deleteSession(id)
        wb.unbindSessionFromPanel(props.spacePath, props.panel.id)
      })
      .catch(() => {})
  }

  const handleToggleSplit = () => {
    const spacePath = props.spacePath
    if (!spacePath) return

    if (props.panel.splitTerminal) {
      setPanelSplitTerminal(spacePath, props.panel.id, false)
      if (props.panel.splitPtyId) {
        sdk.client.pty.remove({ ptyID: props.panel.splitPtyId }).catch(console.error)
        setPanelPtyId(spacePath, props.panel.id, "split", undefined)
      }
    } else {
      setPanelSplitTerminal(spacePath, props.panel.id, true)
    }
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

    // Reject bound Panel
    if (props.panel.slotState === "bound") {
      alert("请先关闭当前会话或选择空 Panel")
      return
    }

    // Only empty or open Panel can accept drop
    if (props.panel.slotState !== "empty" && props.panel.slotState !== "open") return

    // Try local session store first; if not found, it's a server session — create a local reference
    let session = sessionStore.getSession(sessionId)
    if (!session) {
      const projectPath = e.dataTransfer?.getData("text/projectPath") || props.panel.directory
      const sessionTitle = e.dataTransfer?.getData("text/sessionTitle") || sessionId
      session = sessionStore.ensureSessionReference(sessionId, dragSpaceName, projectPath, "chat", sessionTitle)
    }

    // If session is already bound to another panel, check if binding is still valid
    if (session.boundPanelId && session.boundPanelId !== props.panel.id) {
      const boundPanel = wb.spaceState(spacePath)?.panels.find((p) => p.id === session.boundPanelId)
      // Dangling reference: panel no longer exists or no longer bound to this session
      if (!boundPanel || boundPanel.boundSessionId !== sessionId) {
        sessionStore.unbindPanel(sessionId)
      } else {
        // Real binding to another panel — ask user via styled dialog
        dialog.show(() => (
          <DialogMoveSession
            sessionTitle={session.title}
            onConfirm={() => {
              sessionStore.unbindPanel(sessionId)
              wb.unbindSessionFromPanel(spacePath, session.boundPanelId!)
              bindSessionToThisPanel()
            }}
          />
        ))
        return
      }
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

  function DialogMoveSession(props: { sessionTitle: string; onConfirm: () => void }) {
    return (
      <Dialog title={t("workbench.panel.moveSession.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {t("workbench.panel.moveSession.message", { title: props.sessionTitle })}
            </span>
            <span class="text-12-regular text-text-muted">
              {t("workbench.panel.moveSession.hint")}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={() => {
              props.onConfirm()
              dialog.close()
            }}>
              {t("workbench.panel.moveSession.confirm")}
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
      class={`flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-r border-v2-border-border-base last:border-r-0 ${
        props.isActive ? "" : "opacity-90"
      }`}
      style={{ flex: props.panel.width }}
      onClick={props.onActivate}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      data-panel-id={props.panel.id}
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

          {/* 2. Main View wrapper container (physically kept but visually toggled via hidden class) */}
          <Show when={props.panel.viewMode} keyed>
            {(vm) => {
              const viewDef = getView(vm)
              if (!viewDef) {
                return (
                  <div class="flex items-center justify-center h-full text-v2-text-text-muted text-12-regular">
                    Unknown view: {vm}
                  </div>
                )
              }
              const session = props.panel.boundSessionId
                ? sessionStore.getSession(props.panel.boundSessionId)
                : undefined
              return (
                <div class="w-full h-full" classList={{ "hidden": props.panel.slotState === "empty" }}>
                  {viewDef.render({
                    panel: props.panel,
                    session,
                    directory: props.panel.directory,
                    sdk,
                    spaceName: props.spaceName,
                    spacePath: props.panel.directory,
                  })}
                </div>
              )
            }}
          </Show>
        </div>

        {/* Split Divider Handle */}
        <Show when={props.panel.splitTerminal}>
          <div
            class="h-1 hover:h-1.5 z-20 cursor-row-resize bg-v2-border-border-base hover:bg-v2-icon-icon-brand transition-all flex-shrink-0"
            onMouseDown={handleSplitResizeStart}
            title="拖动调整终端高度"
          />
        </Show>

        {/* Lower Split Terminal Area */}
        <Show when={props.panel.splitTerminal}>
          <div
            class="min-w-0 flex flex-col relative overflow-hidden bg-v2-background-bg-deep flex-shrink-0"
            style={{ height: `${splitHeight()}px` }}
          >
            <div class="flex h-6 shrink-0 items-center justify-between px-2 bg-v2-background-bg-base border-b border-v2-border-border-base text-10-medium text-v2-text-text-muted select-none">
              <span class="uppercase tracking-wider">Terminal (Split)</span>
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
                    <span class="text-10-regular">Starting split shell...</span>
                  </div>
                }
              >
                {(ptyId) => (
                  <Terminal
                    pty={{ id: ptyId(), title: "split terminal", titleNumber: 3 }}
                    class="w-full h-full"
                    onConnectError={() => setPanelPtyId(props.spacePath, props.panel.id, "split", undefined)}
                  />
                )}
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
