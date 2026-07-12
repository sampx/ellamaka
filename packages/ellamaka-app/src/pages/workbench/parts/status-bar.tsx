import { Show, createMemo } from "solid-js"
import { useServer } from "@/context/server"
import { useWorkbenchState } from "../view-store"
import { useSessionStore } from "../session-store"

export function StatusBar() {
  const wb = useWorkbenchState()
  const sessionStore = useSessionStore()
  const server = useServer()

  const activePath = createMemo(() => wb.activeTab()?.path ?? "")
  const space = createMemo(() => wb.spaceState(activePath()))
  const panelCount = createMemo(() => space()?.panels.length ?? 0)
  const spaceName = createMemo(() => wb.activeTab()?.name ?? "")

  const activePanelInfo = createMemo(() => {
    const sp = space()
    if (!sp || !sp.activePanelID) return undefined
    const idx = sp.panels.findIndex((p) => p.id === sp.activePanelID)
    if (idx === -1) return undefined
    const panel = sp.panels[idx]
    return {
      index: idx + 1,
      sessionTitle: panel.slotState === "bound"
        ? sessionStore.getSession(panel.boundSessionId ?? "")?.title
        : undefined,
    }
  })

  return (
    <footer class="flex h-6 shrink-0 items-center gap-2 border-t border-v2-border-border-base bg-v2-background-bg-base px-2 text-10-regular text-v2-text-text-muted select-none">
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <Show when={spaceName()}>
          <span class="shrink-0">{spaceName()}</span>
        </Show>
        <Show when={activePanelInfo()}>
          {(info) => (
            <>
              <span class="text-v2-text-text-faint">/</span>
              <span class="shrink-0 rounded bg-v2-background-bg-deep px-1.5 py-px">P{info().index}/{panelCount()}</span>
              <Show when={info().sessionTitle}>
                <span class="text-v2-text-text-faint">/</span>
                <span class="min-w-0 truncate text-v2-text-text-base" title={info().sessionTitle}>{info().sessionTitle}</span>
              </Show>
            </>
          )}
        </Show>
      </div>
      <div class="flex max-w-48 shrink-0 items-center gap-1.5 border-l border-v2-border-border-base pl-2">
        <span class="size-1.5 rounded-full bg-v2-icon-icon-accent" />
        <span class="truncate">{server.name}</span>
      </div>
    </footer>
  )
}
