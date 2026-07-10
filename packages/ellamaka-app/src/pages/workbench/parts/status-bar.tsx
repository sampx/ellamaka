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

  return (
    <footer class="flex h-5 shrink-0 items-center gap-3 px-3 bg-v2-background-bg-base border-t border-v2-border-border-base text-10-regular text-v2-text-text-muted">
      <span class="size-1.5 rounded-full bg-v2-icon-icon-success" />
      <span class="truncate">{server.name}</span>
      <Show when={activePath()}>
        <span class="text-v2-text-text-faint">·</span>
        <span class="truncate max-w-48">{activePath()}</span>
      </Show>
      <div class="grow" />
      <Show when={panelCount() > 0}>
        <span class="text-v2-text-text-faint">
          {language.t("workbench.status.panels", { count: String(panelCount()) })}
        </span>
      </Show>
    </footer>
  )
}
