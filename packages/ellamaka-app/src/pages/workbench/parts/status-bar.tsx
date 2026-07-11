import { Show, createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useWorkbenchState } from "../view-store"

export function StatusBar() {
  const wb = useWorkbenchState()
  const server = useServer()
  const language = useLanguage()

  const activePath = createMemo(() => wb.activeTab()?.path ?? "")
  const space = createMemo(() => {
    const path = activePath()
    if (!path) return undefined
    return wb.spaceState(path)
  })
  const panelCount = createMemo(() => space()?.panels.length ?? 0)

  // Active space name
  const spaceName = createMemo(() => wb.activeTab()?.name ?? "")

  // Active panel number and its directory path
  const activePanelInfo = createMemo(() => {
    const sp = space()
    if (!sp || !sp.activePanelID) return undefined
    const idx = sp.panels.findIndex((p) => p.id === sp.activePanelID)
    if (idx === -1) return undefined
    const panel = sp.panels[idx]
    return {
      index: idx + 1,
      directory: panel.directory || "",
    }
  })

  return (
    <footer class="flex h-5 shrink-0 items-center justify-between px-3 bg-v2-background-bg-base border-t border-v2-border-border-base text-10-regular text-v2-text-text-muted select-none">
      {/* 1. Left Section: Connection & Server */}
      <div class="flex items-center gap-1.5 min-w-[150px]">
        <span class="size-1.5 rounded-full bg-v2-icon-icon-success" />
        <span class="truncate">{server.name}</span>
      </div>

      {/* 2. Middle Section (Bold): Interactive Help & Action Hint */}
      <div class="flex-1 text-center font-medium text-v2-text-text-base truncate px-4">
        {wb.statusMessage}
      </div>

      {/* 3. Right Section: Active Panel Metadata & Stats */}
      <div class="flex items-center gap-2 min-w-[200px] justify-end">
        <Show when={activePanelInfo()}>
          {(info) => (
            <div class="flex items-center gap-1 bg-v2-background-bg-deep px-1.5 py-0.5 rounded text-[9px] text-v2-text-text-muted border border-v2-border-border-base">
              <span>{language.t("workbench.status.space")}: <strong class="text-v2-text-text-base font-semibold">{spaceName()}</strong></span>
              <span class="text-v2-text-text-faint/50">|</span>
              <span>{language.t("workbench.status.panel")}: <strong class="text-v2-text-text-base font-semibold">{info().index}</strong></span>
              <Show when={info().directory}>
                <span class="text-v2-text-text-faint/50">|</span>
                <span class="truncate max-w-40" title={info().directory}>{language.t("workbench.status.path")}: {info().directory}</span>
              </Show>
            </div>
          )}
        </Show>
        <Show when={panelCount() > 0}>
          <span class="text-v2-text-text-faint scale-90">
            {language.t("workbench.status.panels", { count: String(panelCount()) })}
          </span>
        </Show>
      </div>
    </footer>
  )
}
