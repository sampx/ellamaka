import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { MenuV2 } from "@opencode-ai/ui/v2/components/menu-v2.jsx"
import { Show, createSignal, createEffect, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { Terminal } from "@/components/terminal"
import { useWorkbenchState } from "../view"
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
  const { setPanelPtyId, setPanelSplitTerminal } = useWorkbenchState()
  const [menuOpen, setMenuOpen] = createSignal(false)

  const modeLabel = () => {
    if (props.panel.mode === "tui") return "TUI"
    if (props.panel.mode === "chat") return "CHAT"
    return "TERMINAL"
  }
  const canRemove = () => props.panelCount > 1
  const removeLabel = () =>
    props.panel.mode === "tui" ? t("workbench.panel.forceClose") : t("workbench.panel.remove")

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

  return (
    <div
      class={`flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-r border-v2-border-border-base last:border-r-0 ${
        props.isActive ? "" : "opacity-90"
      }`}
      style={{ flex: props.panel.width }}
      onClick={props.onActivate}
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
              <MenuV2.Item disabled={!canRemove()} onSelect={() => props.onRemove()}>
                {removeLabel()}
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </div>

      {/* Main Mode View Area */}
      <div class="flex flex-1 flex-col min-h-0 overflow-hidden bg-v2-background-bg-deep">
        <div class="flex-1 min-h-0 overflow-hidden relative">
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

        {/* Lower Split Terminal Area */}
        <Show when={props.panel.splitTerminal}>
          <div class="h-1/3 min-h-[140px] flex flex-col border-t border-v2-border-border-base relative overflow-hidden">
            <div class="flex h-6 shrink-0 items-center justify-between px-2 bg-v2-background-bg-base border-b border-v2-border-border-base text-10-medium text-v2-text-text-muted select-none">
              <span class="uppercase tracking-wider">Terminal (Split)</span>
              <button
                class="hover:text-v2-text-text-base cursor-pointer p-0.5 rounded transition-colors"
                onClick={handleToggleSplit}
              >
                ✕
              </button>
            </div>
            <div class="flex-1 min-h-0 overflow-hidden bg-v2-background-bg-deep">
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
