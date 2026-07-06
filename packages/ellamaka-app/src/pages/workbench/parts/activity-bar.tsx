import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useWorkbench, type WorkbenchPanel } from "../view"

type PanelDef = { id: WorkbenchPanel; icon: string; labelKey: string }

const PANELS: PanelDef[] = [
  { id: "spaces", icon: "folder-add-left", labelKey: "workbench.panel.spaces" },
  { id: "search", icon: "magnifying-glass", labelKey: "workbench.panel.search" },
  { id: "history", icon: "outline-dots", labelKey: "workbench.panel.history" },
]

export function ActivityBar() {
  const workbench = useWorkbench()
  const language = useLanguage()

  return (
    <nav class="flex w-11 shrink-0 flex-col items-center gap-1 py-2 bg-v2-background-bg-base border-r border-v2-border-border-base">
      <For each={PANELS}>
        {(def) => (
          <ActivityButton
            icon={def.icon}
            label={language.t(def.labelKey)}
            active={workbench.activePanel() === def.id}
            onClick={() => workbench.togglePanel(def.id)}
          />
        )}
      </For>
      <div class="grow" />
    </nav>
  )
}

function ActivityButton(props: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      class={`relative flex size-9 items-center justify-center rounded-md transition-colors ${
        props.active ? "text-v2-text-text-strong" : "text-v2-icon-icon-muted hover:text-v2-text-text-base"
      }`}
      onClick={props.onClick}
    >
      <Show when={props.active}>
        <span class="absolute left-[-8px] top-2 bottom-2 w-0.5 rounded-full bg-v2-icon-icon-accent" />
      </Show>
      <IconV2 name={props.icon} />
    </button>
  )
}
