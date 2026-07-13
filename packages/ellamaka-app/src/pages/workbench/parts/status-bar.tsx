import { Show, createMemo, For } from "solid-js"
import { useServer } from "@/context/server"
import { useWorkbenchState } from "../view-store"
import { useSessionStore } from "../session-store"
import { SDKProvider } from "@/context/sdk"
import { StatusBarStatusPopover } from "@/components/status-popover"

export type StatusBarSegment = {
  type: "space" | "panel" | "session" | "path"
  text: string
}

export type StatusBarMetadataInput = {
  spaceName: string
  activePanelID: string | undefined
  panels: Array<{
    id: string
    slotState: string
    directory: string
    boundSessionId?: string
  }>
  getSessionTitle: (sessionId: string) => string | undefined
}

export function getStatusBarSegments(input: StatusBarMetadataInput): StatusBarSegment[] {
  const { spaceName, activePanelID, panels, getSessionTitle } = input
  const segments: StatusBarSegment[] = []
  if (!spaceName) return segments

  segments.push({ type: "space", text: spaceName })

  if (!activePanelID) return segments
  const idx = panels.findIndex((p) => p.id === activePanelID)
  if (idx === -1) return segments
  const panel = panels[idx]
  const pIndex = idx + 1

  segments.push({
    type: "panel",
    text: `P${pIndex}/${panels.length}`,
  })

  if (panel.slotState === "bound" && panel.boundSessionId) {
    const title = getSessionTitle(panel.boundSessionId)
    if (title) {
      segments.push({ type: "session", text: title })
    }
  }

  if (panel.directory) {
    const pathText = panel.directory.startsWith("/")
      ? panel.directory.slice(1)
      : panel.directory
    segments.push({ type: "path", text: pathText })
  }

  return segments
}

export function StatusBar() {
  const wb = useWorkbenchState()
  const sessionStore = useSessionStore()
  const server = useServer()

  const activePath = createMemo(() => wb.activeTab()?.path ?? "")
  const space = createMemo(() => wb.spaceState(activePath()))
  const spaceName = createMemo(() => wb.activeTab()?.name ?? "")

  const activeDirectoryContext = createMemo(() => {
    // MCP and plugin state is directory-scoped. The space path only groups
    // sessions; the active panel carries the bound session's real directory.
    return { dir: wb.activeDirectory }
  })

  const segments = createMemo(() => {
    const name = spaceName()
    const sp = space()
    if (!name || !sp) return []
    return getStatusBarSegments({
      spaceName: name,
      activePanelID: sp.activePanelID,
      panels: sp.panels,
      getSessionTitle: (id) => sessionStore.getSession(id)?.title,
    })
  })

  return (
    <footer class="flex h-6 shrink-0 items-center justify-between gap-2 border-t border-v2-border-border-base bg-v2-background-bg-base px-2 text-10-regular text-v2-text-text-muted select-none">
      {/* 左区：空间 / panel / 会话 / 路径 的现代紧凑层级链 */}
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <For each={segments()}>
          {(seg, idx) => (
            <>
              <Show when={idx() > 0}>
                <span class="text-v2-text-text-faint select-none">/</span>
              </Show>
              <span
                class="truncate text-v2-text-text-muted"
                title={seg.type === "path" ? "/" + seg.text : seg.text}
              >
                {seg.text}
              </span>
            </>
          )}
        </For>
      </div>

      {/* 右区：Server 状态控制按钮 + 名字，带有左边框分割 */}
      <div class="flex max-w-48 shrink-0 items-center gap-1 border-l border-v2-border-border-base pl-2">
        <Show when={activeDirectoryContext()} keyed>
          {({ dir }) => (
            <SDKProvider directory={dir}>
              <StatusBarStatusPopover />
            </SDKProvider>
          )}
        </Show>
        <span class="truncate select-none ml-1">{server.name}</span>
      </div>
    </footer>
  )
}
