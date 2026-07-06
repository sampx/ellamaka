import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { For, Show, createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSpaceStore, type WopalSpace } from "../space-store"

export function Sidebar() {
  const store = useSpaceStore()
  const language = useLanguage()
  const t = (k: string) => language.t(k)

  const openTabs = createMemo(() => new Set(store.tabs.map((tab) => tab.name)))

  return (
    <aside class="flex w-56 shrink-0 flex-col bg-v2-background-bg-deep border-r border-v2-border-border-base">
      <header class="flex h-7 items-center justify-between px-3">
        <span class="text-10-medium text-v2-text-text-muted uppercase [letter-spacing:1.5px]">
          {t("workbench.sidebar.spaces")}
        </span>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="folder-add-left" />}
          aria-label={t("workbench.sidebar.refresh")}
          onClick={() => store.reload()}
        />
      </header>

      <Show
        when={store.spaces().length > 0}
        fallback={
          <Show
            when={!store.spacesLoading}
            fallback={<div class="px-3 py-6 text-12-regular text-v2-text-text-muted">{t("common.loading")}</div>}
          >
            <div class="px-3 py-6 text-center text-12-regular text-v2-text-text-muted">
              {t("workbench.sidebar.empty")}
            </div>
          </Show>
        }
      >
        <div class="flex-1 overflow-y-auto px-1.5">
          <For each={store.spaces()}>
            {(space) => (
              <SpaceRow
                space={space}
                isOpen={openTabs().has(space.name)}
                isActive={store.activeName() === space.name}
                onOpen={() => store.openTab(space)}
              />
            )}
          </For>
        </div>
      </Show>
    </aside>
  )
}

function SpaceRow(props: {
  space: WopalSpace
  isOpen: boolean
  isActive: boolean
  onOpen: () => void
}) {
  const name = () => props.space.name

  return (
    <button
      type="button"
      class={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        props.isActive
          ? "bg-v2-overlay-simple-overlay-hover"
          : "hover:bg-v2-overlay-simple-overlay-hover"
      }`}
      onClick={() => props.onOpen()}
    >
      <span
        class={`size-1.5 shrink-0 rounded-full ${
          props.isOpen ? "bg-v2-icon-icon-success" : "bg-v2-icon-icon-muted"
        }`}
      />
      <span class="flex-1 truncate text-12-regular text-v2-text-text-base">{name()}</span>
      <Show when={props.space.type}>
        <span class="rounded px-1 text-9-regular text-v2-text-text-muted bg-v2-background-bg-base">
          {props.space.type}
        </span>
      </Show>
    </button>
  )
}