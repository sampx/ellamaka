import { Show } from "solid-js"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"

/**
 * Panel Chat Header - displays directory path, model selector, agent selector.
 *
 * Part of the Panel Chat view header, coordinated with Task 7's panel header.
 * Shows the working directory and provides access to model/agent selection.
 */
export function PanelChatHeader(props: { directory: string }) {
  return (
    <div class="flex h-7 shrink-0 items-center gap-2 px-2 border-b border-v2-border-border-base bg-v2-background-bg-base">
      {/* Directory path indicator */}
      <IconV2 name="folder" class="size-3.5 text-v2-text-text-faint shrink-0" />
      <span class="text-10-regular text-v2-text-text-muted truncate" title={props.directory}>
        {props.directory}
      </span>

      <div class="grow" />

      {/* Model selector placeholder — use ModelSelectorPopover from @/components/dialog-select-model when SDKProvider is available */}
      <Show when={false}>
        <button
          type="button"
          class="flex items-center gap-1 px-1.5 py-0.5 rounded text-10-regular text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover cursor-pointer transition-colors"
          disabled
        >
          <IconV2 name="cube" class="size-3" />
          <span>Model</span>
        </button>
      </Show>

      {/* Agent selector placeholder — no AgentSelector component found upstream */}
      <Show when={false}>
        <button
          type="button"
          class="flex items-center gap-1 px-1.5 py-0.5 rounded text-10-regular text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover cursor-pointer transition-colors"
          disabled
        >
          <IconV2 name="bot" class="size-3" />
          <span>Agent</span>
        </button>
      </Show>
    </div>
  )
}
