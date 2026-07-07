import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { MenuV2 } from "@opencode-ai/ui/v2/components/menu-v2.jsx"
import { Show, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
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
  const [menuOpen, setMenuOpen] = createSignal(false)

  const modeLabel = () => (props.panel.mode === "tui" ? t("workbench.view.tui") : t("workbench.view.chat"))
  const canRemove = () => props.panelCount > 1
  const removeLabel = () =>
    props.panel.mode === "tui" ? t("workbench.panel.forceClose") : t("workbench.panel.remove")

  return (
    <div
      class={`flex min-w-0 flex-col overflow-hidden border-r border-v2-border-border-base last:border-r-0 ${
        props.isActive ? "" : "opacity-80"
      }`}
      style={{ flex: props.panel.width }}
      onClick={props.onActivate}
    >
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
          class={`px-1.5 py-0.5 rounded text-10-regular transition-colors ${
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
          class={`px-1.5 py-0.5 rounded text-10-regular transition-colors ${
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
              <MenuV2.Item disabled={!canRemove()} onSelect={() => props.onRemove()}>
                {removeLabel()}
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </div>

      <div class="flex flex-1 items-center justify-center overflow-hidden">
        <Show
          when={props.panel.mode === "tui"}
          fallback={
            <div class="flex flex-col items-center gap-2 text-v2-text-text-muted">
              <IconV2 name="edit" class="size-6 opacity-40" />
              <span class="text-12-regular">{t("workbench.view.chat.placeholder")}</span>
            </div>
          }
        >
          <div class="flex flex-col items-center gap-2 text-v2-text-text-muted">
            <IconV2 name="terminal" class="size-6 opacity-40" />
            <span class="text-12-regular">{t("workbench.view.tui.placeholder")}</span>
          </div>
        </Show>
      </div>
    </div>
  )
}
