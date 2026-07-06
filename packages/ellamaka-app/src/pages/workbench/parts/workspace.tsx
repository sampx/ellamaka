import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSpaceStore } from "../space-store"
import { useWorkbench } from "../view"

export function Workspace() {
  const store = useSpaceStore()
  const language = useLanguage()
  const t = (k: string) => language.t(k)

  return (
    <main class="flex min-w-0 flex-1 flex-col bg-v2-background-bg-base">
      <TabBar />
      <div class="flex flex-1 items-center justify-center overflow-hidden">
        <Show
          when={store.activeTab()}
          fallback={<EmptyStage hint={t("workbench.workspace.empty")} />}
        >
          {(tab) => <ActiveStage name={tab().name} view={useWorkbench().view()} hint={t("workbench.view.tui.placeholder")} />}
        </Show>
      </div>
    </main>
  )
}

function TabBar() {
  const store = useSpaceStore()
  const language = useLanguage()
  const t = (k: string) => language.t(k)

  return (
    <Show when={store.tabs.length > 0}>
      <div class="flex h-8 shrink-0 items-center gap-0.5 border-b border-v2-border-border-base bg-v2-background-bg-base px-2">
        <For each={store.tabs}>
          {(tab) => (
            <button
              type="button"
              class={`group flex items-center gap-1.5 rounded-t-md px-2.5 py-1 text-12-regular transition-colors ${
                store.activeName() === tab.name
                  ? "bg-v2-background-bg-deep text-v2-text-text-strong border-x border-t border-v2-border-border-base -mb-px"
                  : "text-v2-text-text-muted hover:text-v2-text-text-base"
              }`}
              onClick={() => store.setActive(tab.name)}
            >
              <span class="max-w-32 truncate">{tab.name}</span>
              <span
                class="flex size-4 items-center justify-center rounded text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                onClick={(e) => {
                  e.stopPropagation()
                  store.closeTab(tab.name)
                }}
              >
                <IconV2 name="xmark-small" />
              </span>
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}

function EmptyStage(props: { hint: string }) {
  return (
    <div class="flex flex-col items-center gap-3 text-v2-text-text-muted">
      <IconV2 name="folder-add-left" class="size-8 opacity-40" />
      <span class="text-12-regular text-v2-text-text-muted">{props.hint}</span>
    </div>
  )
}

function ActiveStage(props: { name: string; view: string; hint: string }) {
  return (
    <div class="flex h-full w-full flex-col items-center justify-center gap-3 text-v2-text-text-muted">
      <IconV2 name="grid-plus" class="size-8 opacity-40" />
      <span class="text-13-regular text-v2-text-text-base">{props.name}</span>
      <span class="text-12-regular text-v2-text-text-muted">{props.hint}</span>
    </div>
  )
}