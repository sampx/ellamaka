import { createSignal, Show } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useSessionStore } from "../session-store"
import { useWorkbenchState } from "../view"
import type { WorkbenchPanel } from "../view"

export function PanelLoader(props: {
  panel: WorkbenchPanel
  spaceName: string
  spacePath: string
}) {
  const sdk = useSDK()
  const sessionStore = useSessionStore()
  const wb = useWorkbenchState()

  const [creating, setCreating] = createSignal(false)

  const directory = () => props.panel.directory

  const handleStartSession = async () => {
    if (creating()) return
    setCreating(true)
    try {
      const res = await sdk.client.session.create()
      const serverSession = res.data
      if (!serverSession?.id) {
        throw new Error("Session creation returned no session id")
      }
      const title = serverSession.title ?? `${directory().split("/").pop() ?? "New"} chat`
      sessionStore.ensureSessionReference(serverSession.id, props.spaceName, directory(), "chat", title)
      sessionStore.bindPanel(serverSession.id, props.panel.id)
      wb.bindSessionToPanel(props.spacePath, props.panel.id, serverSession.id)
      sessionStore.triggerRefresh()
    } catch (err) {
      console.error("Failed to create session", err)
    } finally {
      setCreating(false)
    }
  }

  const handleQuickTerminal = () => {
    wb.openTerminalInPanel(props.spacePath, props.panel.id, directory())
  }

  return (
    <div class="flex flex-col items-center justify-center h-full gap-4 px-6 text-center bg-v2-background-bg-deep">
      <div class="text-14-medium text-v2-text-text-muted">
        当前 Space: {props.spaceName}
      </div>

      <button
        type="button"
        class="px-4 py-1.5 rounded-md bg-v2-icon-icon-brand text-white text-12-medium cursor-pointer transition-colors hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={creating()}
        onClick={handleStartSession}
      >
        <Show when={!creating()} fallback="创建中...">新建 Chat 会话</Show>
      </button>

      <div class="flex items-center gap-2 w-full max-w-xs">
        <div class="flex-1 h-px bg-v2-border-border-base" />
        <span class="text-10-regular text-v2-text-text-faint shrink-0">或</span>
        <div class="flex-1 h-px bg-v2-border-border-base" />
      </div>

      <button
        type="button"
        class="px-4 py-1.5 rounded-md border border-v2-border-border-base bg-v2-background-bg-deep text-v2-text-text-base text-12-medium cursor-pointer transition-colors hover:bg-v2-overlay-simple-overlay-hover"
        onClick={handleQuickTerminal}
      >
        打开当前空间 Terminal
      </button>
    </div>
  )
}
