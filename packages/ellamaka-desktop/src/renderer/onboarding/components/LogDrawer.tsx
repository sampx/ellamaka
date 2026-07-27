import { createSignal, Show, For, createEffect } from "solid-js"
import { zhCN } from "../content/zh-CN"

export interface LogEntry {
  text: string
  isError?: boolean
  timestamp?: string
}

export interface LogDrawerProps {
  logs: LogEntry[]
  onClear?: () => void
  onCopy?: () => void
}

export function LogDrawer(props: LogDrawerProps) {
  const [expanded, setExpanded] = createSignal(true)
  const errorCount = () => props.logs.filter((l) => l.isError).length
  let bodyRef: HTMLDivElement | undefined

  // Auto-scroll to bottom when logs change
  createEffect(() => {
    props.logs.length
    if (bodyRef) {
      bodyRef.scrollTop = bodyRef.scrollHeight
    }
  })

  const handleCopy = async () => {
    const text = props.logs.map((l) => l.text).join("\n")
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // fallback: select text
    }
    props.onCopy?.()
  }

  return (
    <div class="ob-log-drawer">
      <div class="ob-log-header" onClick={() => setExpanded(!expanded())}>
        <div class="ob-log-header-left">
          <span class="ob-log-icon">{expanded() ? "▼" : "▲"}</span>
          <span class="ob-log-title">日志</span>
          <Show when={errorCount() > 0}>
            <span class="ob-log-error-badge">{errorCount()} 错误</span>
          </Show>
        </div>
        <div class="ob-log-header-actions" onClick={(e) => e.stopPropagation()}>
          <Show when={expanded()}>
            <button class="ob-log-action-btn" onClick={handleCopy} title={zhCN.actions.copy}>
              {zhCN.actions.copy}
            </button>
            <button class="ob-log-action-btn" onClick={() => props.onClear?.()} title={zhCN.actions.clear}>
              {zhCN.actions.clear}
            </button>
          </Show>
        </div>
      </div>
      <Show when={expanded()}>
        <div class="ob-log-body" ref={bodyRef}>
          <For each={props.logs}>
            {(log) => (
              <div class={log.isError ? "ob-log-line ob-log-err" : "ob-log-line"}>
                {log.text}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
