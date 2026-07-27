import { createSignal, onMount, Show, For } from "solid-js"

export function DoneStep() {
  const [isLaunching, setIsLaunching] = createSignal<boolean>(false)
  const [warnings, setWarnings] = createSignal<string[]>([])
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null)
  const [summary, setSummary] = createSignal<Record<string, unknown> | null>(null)

  onMount(async () => {
    try {
      const state = await window.api.onboardingGetState()
      if (state && state.warnings) {
        setWarnings(state.warnings)
      }
      // Try to get final inspect summary
      const envRes = await window.api.onboardingProbe("environment")
      if (envRes) {
        setSummary(envRes as Record<string, unknown>)
      }
    } catch {
      // ignore
    }
  })

  const handleLaunch = async () => {
    setIsLaunching(true)
    setErrorMsg(null)
    try {
      const result = await window.api.onboardingComplete()
      if (result.status === "failed") {
        setErrorMsg(result.error?.message ?? "运行时健康检查未通过，请返回相应步骤完成配置。")
        setIsLaunching(false)
        return
      }
      // In-process transition: bring up sidecar + reload window to workbench.
      // No app.relaunch() — env vars (WOPAL_HOME etc.) stay in-process.
      const transition = await window.api.onboardingTransitionToWorkbench()
      if (transition.status === "error") {
        setErrorMsg(transition.message ?? "启动工作台失败，请手动重启应用。")
        setIsLaunching(false)
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "启动工作台失败，请手动重启应用。")
      setIsLaunching(false)
    }
  }

  return (
    <div class="ob-step-content" style={{ "text-align": "center", padding: "24px 0" }}>
      <div style={{ "font-size": "48px", "margin-bottom": "12px" }}>🎉</div>
      <h3 style={{ "font-size": "22px", "font-weight": "800", color: "#fff" }}>设置完成！</h3>
      <p style={{ "font-size": "14px", color: "var(--ob-text-muted)", "max-width": "440px", margin: "0 auto 28px", "line-height": "1.6" }}>
        WopalSpace AI 编程助手环境已成功配置。点击下方按钮启动工作台。
      </p>

      <Show when={summary()}>
        <div class="ob-result-details" style={{ "text-align": "left", "margin-bottom": "20px" }}>
          <div class="ob-result-row">
            <span class="ob-result-label">工作空间</span>
            <span class="ob-result-value">{(summary()?.spaces as any[])?.length ?? 0} 个已注册</span>
          </div>
          <div class="ob-result-row">
            <span class="ob-result-label">本体仓库</span>
            <span class="ob-result-value">{(summary()?.ontologyInstalled as boolean) ? "已安装" : "未安装"}</span>
          </div>
          <div class="ob-result-row">
            <span class="ob-result-label">可用类型</span>
            <span class="ob-result-value">{(summary()?.availableTypes as any[])?.length ?? 0} 种</span>
          </div>
        </div>
      </Show>

      <Show when={warnings().length > 0}>
        <div style={{ "background": "rgba(255, 170, 0, 0.1)", "border": "1px solid rgba(255, 170, 0, 0.3)", "padding": "12px", "border-radius": "8px", "margin-bottom": "24px", "text-align": "left", "color": "#fcd34d", "font-size": "13px" }}>
          <div style={{ "font-weight": "600", "margin-bottom": "6px" }}>⚠️ 非致命警告 / 已跳过步骤：</div>
          <ul style={{ "margin": 0, "padding-left": "20px" }}>
            <For each={warnings()}>
              {(w) => <li>{w}</li>}
            </For>
          </ul>
        </div>
      </Show>

      <Show when={errorMsg()}>
        <div style={{ "background": "rgba(255, 68, 68, 0.1)", "border": "1px solid rgba(255, 68, 68, 0.3)", "padding": "12px", "border-radius": "8px", "margin-bottom": "24px", "text-align": "left", "color": "#ff6b6b", "font-size": "13px" }}>
          <div>❌ {errorMsg()}</div>
        </div>
      </Show>

      <div style={{ display: "flex", "justify-content": "center" }}>
        <button class="ob-button" style={{ padding: "14px 36px", "font-size": "16px" }} onClick={handleLaunch} disabled={isLaunching()}>
          <Show when={isLaunching()} fallback={<span>🚀 启动工作台</span>}>
            <span class="ob-spinner" style={{ width: "18px", height: "18px", "border-width": "2px" }} />
            <span>正在启动…</span>
          </Show>
        </button>
      </div>
    </div>
  )
}
