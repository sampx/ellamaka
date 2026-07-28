import { createSignal, onMount, Show, For } from "solid-js"

export function DoneStep() {
  const [isLaunching, setIsLaunching] = createSignal<boolean>(false)
  const [warnings, setWarnings] = createSignal<string[]>([])
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null)
  const [summary, setSummary] = createSignal<Record<string, unknown> | null>(null)
  const [starred, setStarred] = createSignal<boolean>(false)

  onMount(async () => {
    try {
      // Quietly trigger star guide step
      void window.api.onboardingExecuteStep("star-guide", { action: "star" })
        .then((res) => {
          if (res.status === "completed" || res.status === "reused") setStarred(true)
        })
        .catch(() => {})

      const state = await window.api.onboardingGetState()
      if (state && state.warnings) {
        setWarnings(state.warnings)
      }
      const envRes = await window.api.onboardingProbe("environment")
      if (envRes) {
        setSummary(envRes as Record<string, unknown>)
      }
    } catch {
      // ignore
    }
  })

  const handleManualStar = async () => {
    try {
      await window.api.onboardingExecuteStep("star-guide", { action: "star" })
      setStarred(true)
    } catch {
      // ignore
    }
  }

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
      <p style={{ "font-size": "14px", color: "var(--ob-text-muted)", "max-width": "440px", margin: "0 auto 24px", "line-height": "1.6" }}>
        WopalSpace AI 编程助手环境已成功配置。点击下方按钮启动工作台。
      </p>

      <Show when={summary()}>
        <div class="ob-result-details" style={{ "text-align": "left", "margin-bottom": "20px" }}>
          <div class="ob-result-row">
            <span class="ob-result-label">工作空间</span>
            <span class="ob-result-value">{(summary()?.spaces as any[])?.length ?? 0} 个已注册</span>
          </div>
          <div class="ob-result-row">
            <span class="ob-result-label">能力模板库</span>
            <span class="ob-result-value">{(summary()?.ontologyInstalled as boolean) ? "已准备就绪" : "未准备"}</span>
          </div>
          <div class="ob-result-row">
            <span class="ob-result-label">可用类型</span>
            <span class="ob-result-value">{(summary()?.availableTypes as any[])?.length ?? 0} 种</span>
          </div>
        </div>
      </Show>

      {/* Community Support Card */}
      <div class="ob-community-card" style={{
        "background": "rgba(255, 255, 255, 0.03)",
        "border": "1px solid rgba(255, 255, 255, 0.08)",
        "border-radius": "8px",
        "padding": "16px",
        "margin-bottom": "24px",
        "text-align": "left",
        "display": "flex",
        "align-items": "center",
        "justify-content": "space-between",
      }}>
        <div>
          <div style={{ "font-weight": "600", "font-size": "14px", "margin-bottom": "4px" }}>
            ⭐ 支持 WopalSpace 开源项目
          </div>
          <div style={{ "font-size": "12px", color: "var(--ob-text-subtle)" }}>
            点亮 GitHub Star，支持团队持续交付下一代 AI 编程工具。
          </div>
        </div>
        <button
          type="button"
          class="ob-button ob-button-secondary"
          onClick={handleManualStar}
          disabled={starred()}
          style={{ "white-space": "nowrap", padding: "8px 14px", "font-size": "13px" }}
        >
          {starred() ? "已支持 ⭐" : "⭐ 点亮 Star"}
        </button>
      </div>

      <Show when={warnings().length > 0}>
        <div style={{ "background": "rgba(255, 170, 0, 0.1)", "border": "1px solid rgba(255, 170, 0, 0.3)", "padding": "12px", "border-radius": "8px", "margin-bottom": "24px", "text-align": "left", "color": "#fcd34d", "font-size": "13px" }}>
          <div style={{ "font-weight": "600", "margin-bottom": "6px" }}>⚠️ 提示：</div>
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
