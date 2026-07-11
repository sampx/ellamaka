import { createSignal, Show, createResource, For, createEffect } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useSessionStore } from "../session-store"
import { useWorkbenchState } from "../view-store"
import type { WorkbenchPanel } from "../view-store"

export function PanelLoader(props: {
  panel: WorkbenchPanel
  spaceName: string
  spacePath: string
}) {
  const sdk = useSDK()
  const sessionStore = useSessionStore()
  const wb = useWorkbenchState()

  const [creating, setCreating] = createSignal(false)
  const [selectedDir, setSelectedDir] = createSignal(props.spacePath)

  // Reset selected directory when space changes
  createEffect(() => {
    setSelectedDir(props.spacePath)
  })

  // Fetch projects inside the current space
  const [overview] = createResource(
    () => props.spaceName,
    async (name) => {
      try {
        const res = await sdk.client.wopalSpace.spaceOverview({ spaceName: name })
        return res.data
      } catch (err) {
        console.error("Failed to load space projects", err)
        return null
      }
    }
  )

  const handleStartSession = async () => {
    if (creating()) return
    setCreating(true)
    try {
      let targetDir = selectedDir().trim()
      if (props.spacePath === "") {
        const pathRes = await sdk.client.path.get()
        const wopalHome = pathRes.data?.wopalHome || `${pathRes.data?.home || ""}/.wopal`
        const now = new Date()
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`
        targetDir = `${wopalHome}/general_tasks/${dateStr}`
      }

      if (!targetDir) {
        setCreating(false)
        return
      }

      const res = await sdk.client.session.create({ directory: targetDir })
      const serverSession = res.data
      if (!serverSession?.id) {
        throw new Error("Session creation returned no session id")
      }
      const title = serverSession.title ?? (props.spacePath === "" ? "New chat" : `${targetDir.split("/").pop() ?? "New"} chat`)
      sessionStore.ensureSessionReference(serverSession.id, props.spaceName, targetDir, "chat", title)
      wb.bindSessionToPanel(props.spacePath, props.panel.id, serverSession.id)
      sessionStore.triggerRefresh()
    } catch (err) {
      console.error("Failed to create session", err)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div class="flex flex-col items-center justify-center h-full gap-6 px-6 text-center bg-v2-background-bg-deep select-none">
      <div class="flex flex-col gap-2 max-w-sm">
        <div class="text-16-bold text-v2-text-text-strong">
          未装载会话
        </div>
        <div class="text-12-regular text-v2-text-text-muted leading-relaxed">
          当前空间: <span class="text-v2-text-text-base [font-weight:530]">{props.spaceName === "General" ? "Sessions" : props.spaceName}</span>
          <br />
          <Show when={props.spacePath !== ""} fallback="你可以从左侧的会话树中双击或拖拽历史会话进行恢复，也可以点击下方按钮新建独立会话。">
            你可以从左侧的会话树中双击或拖拽历史会话进行恢复，也可以在下方选择项目目录创建新会话。
          </Show>
        </div>
      </div>

      <div class="flex flex-col gap-4 w-full max-w-xs items-center bg-v2-background-bg-base border border-v2-border-border-base p-4 rounded-lg shadow-sm">
        <Show when={props.spacePath !== ""}>
          <div class="flex flex-col gap-3 w-full text-left">
            <div class="flex flex-col gap-1.5 w-full">
              <label class="text-11-medium text-v2-text-text-muted">项目绝对路径</label>
              <input
                type="text"
                class="w-full px-2.5 py-1.5 rounded-md border border-v2-border-border-base bg-v2-background-bg-deep text-v2-text-text-base text-12-regular outline-none focus:border-v2-icon-icon-brand focus:ring-1 focus:ring-v2-icon-icon-brand"
                value={selectedDir()}
                onInput={(e) => setSelectedDir(e.currentTarget.value)}
                placeholder="例如: /path/to/project"
              />
            </div>

            <Show when={(overview()?.projects?.length ?? 0) > 0}>
              <div class="flex flex-col gap-1.5 w-full">
                <label class="text-11-medium text-v2-text-text-muted">或从空间项目快捷选择</label>
                <select
                  class="w-full px-2.5 py-1.5 rounded-md border border-v2-border-border-base bg-v2-background-bg-deep text-v2-text-text-base text-12-regular outline-none focus:border-v2-icon-icon-brand focus:ring-1 focus:ring-v2-icon-icon-brand cursor-pointer"
                  onChange={(e) => {
                    if (e.currentTarget.value) {
                      setSelectedDir(e.currentTarget.value)
                    }
                  }}
                  value={selectedDir()}
                >
                  <option value={props.spacePath}>[空间根目录] {props.spaceName}</option>
                  <For each={overview()?.projects ?? []}>
                    {(p) => {
                      const label = p.name || p.path.split("/").pop() || p.path
                      return <option value={p.path}>[项目] {label}</option>
                    }}
                  </For>
                </select>
              </div>
            </Show>
          </div>
        </Show>

        <button
          type="button"
          class="w-full py-2 rounded-md bg-v2-icon-icon-brand text-white text-12-bold cursor-pointer transition-colors hover:opacity-90 active:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={creating()}
          onClick={handleStartSession}
        >
          <Show when={!creating()} fallback="创建中...">新建 Chat 会话</Show>
        </button>
      </div>
    </div>
  )
}
