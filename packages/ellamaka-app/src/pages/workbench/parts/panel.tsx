import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { MenuV2 } from "@opencode-ai/ui/v2/components/menu-v2.jsx"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Show, createSignal, createEffect, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { Terminal } from "@/components/terminal"
import { useWorkbenchState } from "../view"
import { useSessionStore } from "../session-store"
import type { WorkbenchPanel, PanelMode } from "../view"

export function Panel(props: {
  panel: WorkbenchPanel
  isActive: boolean
  panelCount: number
  onActivate: () => void
  onModeChange: (mode: PanelMode) => void
  onRemove: () => void
}) {
  const language = useLanguage()
  const t = (k: string) => language.t(k)
  const sdk = useSDK()
  const wb = useWorkbenchState()
  const { setPanelPtyId, setPanelSplitTerminal } = wb
  const sessionStore = useSessionStore()
  const dialog = useDialog()
  const [menuOpen, setMenuOpen] = createSignal(false)

  const modeLabel = () => {
    if (props.panel.mode === "tui") return "TUI"
    if (props.panel.mode === "chat") return "CHAT"
    return "TERMINAL"
  }
  const canRemove = () => {
    if (props.panel.slotState === "empty" && props.panelCount <= 1) return false
    return true
  }
  const removeLabel = () => {
    if (props.panel.slotState === "bound") return "关闭会话"
    if (props.panel.slotState === "open") return "关闭终端"
    return "移除面板"
  }

  // Effect to manage active main PTY lifecycle based on the current mode
  createEffect(() => {
    const mode = props.panel.mode
    const directory = props.panel.directory
    const spacePath = props.panel.directory || "/"

    if (!spacePath) return

    if (mode === "terminal" && !props.panel.termPtyId) {
      sdk.client.pty
        .create({
          cwd: directory,
          title: `Terminal (${props.panel.id})`,
        })
        .then((res) => {
          const ptyId = res.data?.id
          if (ptyId) {
            setPanelPtyId(spacePath, props.panel.id, "term", ptyId)
          }
        })
        .catch((err) => {
          console.error("Failed to create terminal pty:", err)
        })
    }
  })

  // Effect to manage split terminal PTY lifecycle
  createEffect(() => {
    const splitOpen = props.panel.splitTerminal
    const directory = props.panel.directory
    const spacePath = props.panel.directory || "/"

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
            setPanelPtyId(spacePath, props.panel.id, "split", ptyId)
          }
        })
        .catch((err) => {
          console.error("Failed to create split pty:", err)
        })
    }
  })

  const startTui = () => {
    const directory = props.panel.directory
    const spacePath = props.panel.directory || "/"
    if (!spacePath) return

    sdk.client.pty
      .create({
        command: "/Users/sam/.wopal/bin/ellamaka",
        cwd: directory,
        title: `ellamaka tui (${props.panel.id})`,
      })
      .then((res) => {
        const ptyId = res.data?.id
        if (ptyId) {
          setPanelPtyId(spacePath, props.panel.id, "tui", ptyId)
        }
      })
      .catch((err) => {
        console.error("Failed to create TUI pty:", err)
      })
  }

  const handleToggleSplit = () => {
    const spacePath = props.panel.directory || "/"
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
    const spacePath = props.panel.directory || "/"
    if (!spacePath) return

    const slotState = props.panel.slotState

    // bound Panel: show confirmation dialog
    if (slotState === "bound") {
      dialog.show(() => <DialogClosePanel panel={props.panel} spacePath={spacePath} panelCount={props.panelCount} />)
      return
    }

    // open Panel: kill PTYs and remove
    if (slotState === "open") {
      if (props.panel.termPtyId) {
        sdk.client.pty.remove({ ptyID: props.panel.termPtyId }).catch(console.error)
      }
      if (props.panel.splitPtyId) {
        sdk.client.pty.remove({ ptyID: props.panel.splitPtyId }).catch(console.error)
      }
      if (props.panelCount <= 1) {
        wb.setPanelSlotState(spacePath, props.panel.id, "empty")
        wb.setPanelPtyId(spacePath, props.panel.id, "term", undefined)
        wb.setPanelPtyId(spacePath, props.panel.id, "split", undefined)
        return
      }
      wb.removePanel(spacePath, props.panel.id)
      return
    }

    // empty Panel: direct remove
    if (props.panelCount <= 1) return
    wb.removePanel(spacePath, props.panel.id)
  }

  function DialogClosePanel(props: { panel: WorkbenchPanel; spacePath: string; panelCount: number }) {
    const session = () => sessionStore.getSession(props.panel.boundSessionId ?? "")
    const sessionTitle = () => session()?.title ?? "会话"

    const handleConfirm = () => {
      const spacePath = props.spacePath
      const sessionId = props.panel.boundSessionId
      if (sessionId) sessionStore.unbindPanel(sessionId)

      if (props.panelCount <= 1) {
        // Last panel: clear to empty instead of removing
        wb.setPanelSlotState(spacePath, props.panel.id, "empty")
        wb.setPanelPtyId(spacePath, props.panel.id, "tui", undefined)
        wb.setPanelPtyId(spacePath, props.panel.id, "term", undefined)
        wb.setPanelPtyId(spacePath, props.panel.id, "split", undefined)
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

      const spacePath = props.panel.directory || "/"
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
        <span class="text-10-medium text-v2-text-text-muted uppercase [letter-spacing:1px]">{modeLabel()}</span>

        <span class="text-10-regular text-v2-text-text-faint truncate max-w-40 ml-1">
          {props.panel.directory}
        </span>

        <div class="grow" />

        <button
          type="button"
          class={`px-1.5 py-0.5 rounded text-10-regular transition-colors cursor-pointer ${
            props.panel.mode === "tui"
              ? "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base"
              : "text-v2-text-text-muted hover:text-v2-text-text-base"
          }`}
          onClick={(e) => {
            e.stopPropagation()
            props.onModeChange("tui")
          }}
        >
          TUI
        </button>
        <button
          type="button"
          class={`px-1.5 py-0.5 rounded text-10-regular transition-colors cursor-pointer ${
            props.panel.mode === "chat"
              ? "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base"
              : "text-v2-text-text-muted hover:text-v2-text-text-base"
          }`}
          onClick={(e) => {
            e.stopPropagation()
            props.onModeChange("chat")
          }}
        >
          Chat
        </button>
        <button
          type="button"
          class={`px-1.5 py-0.5 rounded text-10-regular transition-colors cursor-pointer ${
            props.panel.mode === "terminal"
              ? "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base"
              : "text-v2-text-text-muted hover:text-v2-text-text-base"
          }`}
          onClick={(e) => {
            e.stopPropagation()
            props.onModeChange("terminal")
          }}
        >
          Terminal
        </button>

        <MenuV2 gutter={4} modal={false} placement="bottom-end" open={menuOpen()} onOpenChange={setMenuOpen}>
          <MenuV2.Trigger
            as={IconButtonV2}
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="outline-dots" />}
            aria-label={t("common.moreOptions")}
            onClick={(e: MouseEvent) => e.stopPropagation()}
          />
          <MenuV2.Portal>
            <MenuV2.Content>
              <MenuV2.Item onSelect={handleToggleSplit}>
                {props.panel.splitTerminal ? "关闭内嵌终端" : "垂直拆分终端"}
              </MenuV2.Item>
              <MenuV2.Item disabled={!canRemove()} onSelect={handleClose}>
                {removeLabel()}
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </div>

      {/* Main Mode View Area */}
      <div
        class="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden bg-v2-background-bg-deep"
        ref={panelContainerRef}
      >
        <div class="flex-1 min-h-[200px] min-w-0 overflow-hidden relative">
          <Show when={props.panel.mode === "tui"}>
            <Show
              when={props.panel.tuiPtyId}
              fallback={
                <div class="flex flex-col items-center justify-center h-full text-v2-text-text-muted gap-4 px-4 text-center bg-v2-background-bg-base">
                  <IconV2 name="terminal" class="size-8 opacity-40 text-v2-text-text-muted" />
                  <span class="text-13-medium text-v2-text-text-base">
                    是否在 <code class="bg-v2-background-bg-deep px-1.5 py-0.5 rounded text-12-regular select-all break-all">{props.panel.directory}</code> 目录打开 ellamaka tui 界面？
                  </span>
                  <button
                    type="button"
                    class="px-4 py-1.5 rounded-md bg-v2-overlay-simple-overlay-hover hover:bg-v2-overlay-simple-overlay-hover/80 text-v2-text-text-base text-12-medium border border-v2-border-border-base cursor-pointer transition-colors"
                    onClick={startTui}
                  >
                    确认打开
                  </button>
                </div>
              }
            >
              {(ptyId) => (
                <Terminal
                  pty={{ id: ptyId(), title: "ellamaka tui", titleNumber: 1 }}
                  class="w-full h-full"
                  onConnectError={() => setPanelPtyId(props.panel.directory || "/", props.panel.id, "tui", undefined)}
                />
              )}
            </Show>
          </Show>

          <Show when={props.panel.mode === "terminal"}>
            <Show
              when={props.panel.termPtyId}
              fallback={
                <div class="flex flex-col items-center justify-center h-full text-v2-text-text-muted gap-2">
                  <div class="animate-spin rounded-full h-4 w-4 border-2 border-v2-text-text-muted border-t-transparent" />
                  <span class="text-11-regular">Starting terminal session...</span>
                </div>
              }
            >
              {(ptyId) => (
                <Terminal
                  pty={{ id: ptyId(), title: "Terminal", titleNumber: 2 }}
                  class="w-full h-full"
                  onConnectError={() => setPanelPtyId(props.panel.directory || "/", props.panel.id, "term", undefined)}
                />
              )}
            </Show>
          </Show>

          <Show when={props.panel.mode === "chat"}>
            <div class="flex flex-col items-center justify-center h-full gap-2 text-v2-text-text-muted bg-v2-background-bg-base">
              <IconV2 name="edit" class="size-6 opacity-40" />
              <span class="text-12-regular">{t("workbench.view.chat.placeholder")}</span>
            </div>
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
                    onConnectError={() => setPanelPtyId(props.panel.directory || "/", props.panel.id, "split", undefined)}
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
