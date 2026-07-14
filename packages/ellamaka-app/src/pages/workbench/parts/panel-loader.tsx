import { createSignal, Show, createEffect } from "solid-js"
import type { WorkbenchPanel } from "../view-store"
import { useWorkbenchActions } from "../workbench-actions-context"
import { scopeFromTab } from "../workbench-scope"

export function PanelLoader(props: {
  panel: WorkbenchPanel
  spaceName: string
  spacePath: string
}) {
  const actions = useWorkbenchActions()

  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()

  // Reset error when space changes
  createEffect(() => {
    setError(undefined)
  })

  const isGeneral = () => props.spacePath === ""

  const handleStartSession = async () => {
    if (creating()) return
    setCreating(true)
    setError(undefined)
    try {
      await actions.createSession({
        scope: scopeFromTab({ name: props.spaceName, path: props.spacePath }),
        panelID: props.panel.id,
      })
    } catch (err) {
      console.error("Failed to create session", err)
      setError("创建会话失败，请重试")
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
          <Show when={!isGeneral()} fallback="你可以从左侧的会话树中双击或拖拽历史会话进行恢复，也可以点击下方按钮新建独立会话。">
            你可以从左侧的会话树中双击或拖拽历史会话进行恢复，也可以点击下方按钮在当前空间创建新会话。
          </Show>
        </div>
      </div>

      <div class="flex flex-col gap-4 w-full max-w-xs items-center bg-v2-background-bg-base border border-v2-border-border-base p-4 rounded-lg shadow-sm">
        <button
          type="button"
          class="w-full py-2 rounded-md bg-v2-icon-icon-brand text-white text-12-bold cursor-pointer transition-colors hover:opacity-90 active:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={creating()}
          onClick={handleStartSession}
        >
          <Show when={!creating()} fallback="创建中...">新建 Chat 会话</Show>
        </button>

        <Show when={error()}>
          <div class="text-11-regular text-red-500">{error()}</div>
        </Show>
      </div>
    </div>
  )
}
