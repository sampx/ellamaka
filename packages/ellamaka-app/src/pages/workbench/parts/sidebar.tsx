import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { ButtonV2 } from "@opencode-ai/ui/v2/components/button-v2.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { For, Show, createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSpaceStore } from "../space-store"
import { useWorkbenchState } from "../view"
import { WorkbenchSettingsMenu } from "./workbench-settings"

export function SpaceRail() {
  const store = useSpaceStore()
  const wb = useWorkbenchState()
  const language = useLanguage()
  const t = (k: string) => language.t(k)

  const openTabs = createMemo(() => new Set(store.tabs.map((tab) => tab.name)))
  const expanded = createMemo(() => wb.display().showSpaceRail)

  return (
    <aside
      classList={{
        "flex shrink-0 flex-col border-r border-v2-border-border-base bg-v2-background-bg-deep transition-[width] duration-150": true,
        "w-48": expanded(),
        "w-11 items-center": !expanded(),
      }}
    >
      <header classList={{ "flex h-7 shrink-0 items-center": true, "justify-between px-2": expanded(), "justify-center": !expanded() }}>
        <Show
          when={expanded()}
          fallback={
            <IconButtonV2
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="sidebar-right" class="rotate-180" />}
              aria-label={t("workbench.sidebar.expand")}
              onClick={() => wb.setDisplay("showSpaceRail", true)}
            />
          }
        >
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <span class="text-10-medium text-v2-text-text-muted uppercase [letter-spacing:1.5px]">
              {t("workbench.sidebar.spaces")}
            </span>
          </div>
          <div class="flex items-center gap-0.5">
            <ButtonV2
              variant="ghost"
              size="normal"
              class="h-6 px-1.5 text-v2-text-text-muted"
              onClick={() => store.reload()}
            >
              {t("workbench.sidebar.refreshShort")}
            </ButtonV2>
            <IconButtonV2
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="sidebar-right" />}
              aria-label={t("workbench.sidebar.collapse")}
              onClick={() => wb.setDisplay("showSpaceRail", false)}
            />
          </div>
        </Show>
      </header>

      <Show when={expanded()}>
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
                <button
                  type="button"
                  class={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                    store.activeName() === space.name
                      ? "bg-v2-overlay-simple-overlay-hover"
                      : "hover:bg-v2-overlay-simple-overlay-hover"
                  }`}
                  onClick={() => store.openTab(space)}
                >
                  <span
                    class={`size-1.5 shrink-0 rounded-full ${
                      openTabs().has(space.name) ? "bg-v2-icon-icon-success" : "bg-v2-icon-icon-muted"
                    }`}
                  />
                  <span class="flex-1 truncate text-12-regular text-v2-text-text-base">{space.name}</span>
                  <Show when={space.type}>
                    <span class="rounded px-1 text-9-regular text-v2-text-text-muted bg-v2-background-bg-base">
                      {space.type}
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <div classList={{ "mt-auto flex shrink-0 border-t border-v2-border-border-base": true, "justify-center p-1.5": !expanded(), "p-2": expanded() }}>
        <WorkbenchSettingsMenu />
      </div>
    </aside>
  )
}
