import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { For, Show, createEffect, createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSpaceStore } from "../space-store"
import { useWorkbenchState } from "../view"
import { Panel } from "./panel"

export function Workspace() {
  const store = useSpaceStore()
  const wb = useWorkbenchState()
  const language = useLanguage()
  const t = (k: string) => language.t(k)

  const activePath = createMemo(() => store.activeTab()?.path ?? "")

  createEffect(() => {
    const path = activePath()
    if (path) wb.ensureSpace(path)
  })

  const space = createMemo(() => {
    const path = activePath()
    if (!path) return undefined
    return wb.spaceState(path)
  })

  const panels = createMemo(() => space()?.panels ?? [])
  const activePanelID = createMemo(() => space()?.activePanelID ?? panels()[0]?.id ?? "")
  const terminalDockOpen = createMemo(() => space()?.terminalDockOpen ?? false)

  return (
    <main class="flex min-w-0 flex-1 flex-col bg-v2-background-bg-base">
      <StageHeader
        activePath={activePath()}
        panelCount={panels().length}
        terminalDockOpen={terminalDockOpen()}
        onAddPanel={() => {
          const path = activePath()
          if (!path) return
          const id = wb.addPanel(path)
          if (id) wb.setActivePanel(path, id)
        }}
        onToggleTerminalDock={() => {
          const path = activePath()
          if (path) wb.toggleTerminalDock(path)
        }}
      />

      <div class="flex min-h-0 flex-1">
        <Show
          when={panels().length > 0}
          fallback={
            <div class="flex flex-1 items-center justify-center text-v2-text-text-muted">
              <div class="flex flex-col items-center gap-3">
                <IconV2 name="grid-plus" class="size-8 opacity-40" />
                <span class="text-12-regular">{t("workbench.workspace.empty")}</span>
              </div>
            </div>
          }
        >
          <For each={panels()}>
            {(panel) => (
              <Panel
                panel={panel}
                isActive={panel.id === activePanelID()}
                panelCount={panels().length}
                onActivate={() => {
                  const path = activePath()
                  if (path) wb.setActivePanel(path, panel.id)
                }}
                onModeChange={(mode) => {
                  const path = activePath()
                  if (path) wb.setPanelMode(path, panel.id, mode)
                }}
                onRemove={() => {
                  const path = activePath()
                  if (path) wb.removePanel(path, panel.id)
                }}
              />
            )}
          </For>
        </Show>
      </div>
    </main>
  )
}

function StageHeader(props: {
  activePath: string
  panelCount: number
  terminalDockOpen: boolean
  onAddPanel: () => void
  onToggleTerminalDock: () => void
}) {
  const store = useSpaceStore()
  const language = useLanguage()
  const t = (k: string) => language.t(k)

  return (
    <div class="flex h-8 shrink-0 items-center gap-0.5 border-b border-v2-border-border-base bg-v2-background-bg-base px-2">
      <Show when={store.tabs.length > 0}>
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
      </Show>

      <div class="grow" />

      <Show when={props.activePath}>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="plus" />}
          aria-label={t("workbench.panel.add")}
          disabled={props.panelCount >= 3}
          onClick={props.onAddPanel}
        />
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="terminal" />}
          aria-label={t("workbench.terminal.toggle")}
          classList={{ "text-v2-icon-icon-accent": props.terminalDockOpen }}
          onClick={props.onToggleTerminalDock}
        />
      </Show>
    </div>
  )
}
