import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { For, Show, type ParentProps } from "solid-js"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useWorkbench, type WorkbenchView } from "../view"

const VIEW_ORDER: WorkbenchView[] = ["tui", "chat", "split"]

const VIEW_LABEL_KEYS: Record<WorkbenchView, string> = {
  tui: "workbench.view.tui",
  chat: "workbench.view.chat",
  split: "workbench.view.split",
}

export function TopBar() {
  const workbench = useWorkbench()
  const command = useCommand()
  const language = useLanguage()

  const t = (key: string) => language.t(key)

  return (
    <header class="flex h-10 shrink-0 items-center gap-3 px-3 bg-v2-background-bg-base border-b border-v2-border-border-base">
      <Brand />

      <ViewSwitch
        view={workbench.view()}
        onChange={workbench.setView}
        labels={(v) => t(VIEW_LABEL_KEYS[v])}
      />

      <div class="grow" />

      <IconButtonV2
        variant="ghost-muted"
        size="small"
        icon={<IconV2 name="search" />}
        aria-label={t("command.palette")}
        onClick={() => command.show()}
      />
    </header>
  )
}

function Brand() {
  return (
    <div class="flex items-center gap-2 text-v2-text-text-strong [font-weight:530] text-14-regular">
      <div class="size-4 rounded-[5px] bg-gradient-to-br from-v2-icon-icon-brand to-v2-icon-icon-accent" />
      <span class="tracking-wide">Ellamaka</span>
    </div>
  )
}

function ViewSwitch(props: {
  view: WorkbenchView
  onChange: (next: WorkbenchView) => void
  labels: (view: WorkbenchView) => string
}) {
  return (
    <div class="flex gap-0.5 rounded-md bg-v2-background-bg-deep p-0.5 border border-v2-border-border-base">
      <For each={VIEW_ORDER}>
        {(v) => (
          <button
            type="button"
            class={`px-3 py-1 rounded text-12-regular transition-colors ${
              props.view === v
                ? "bg-v2-background-bg-base text-v2-text-text-strong"
                : "text-v2-text-text-muted hover:text-v2-text-text-base"
            }`}
            onClick={() => props.onChange(v)}
          >
            {props.labels(v)}
          </button>
        )}
      </For>
    </div>
  )
}
