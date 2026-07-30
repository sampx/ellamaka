import { createSignal, onMount, Show, For } from "solid-js"

export function DoneStep() {
  const [isLaunching, setIsLaunching] = createSignal<boolean>(false)
  const [warnings, setWarnings] = createSignal<string[]>([])
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null)
  const [starred, setStarred] = createSignal<boolean>(false)
  const [runtimeCheckFinished, setRuntimeCheckFinished] = createSignal<boolean>(false)

  onMount(async () => {
    try {
      // 1. Thorough Final Inspection: Check onboarding state & runtime readiness
      const state = await window.api.onboardingGetState()
      if (state && state.warnings) {
        setWarnings(state.warnings)
      }

      // 2. Perform deep inspection check on runtime
      const runtimeRes = await window.api.onboardingProbe("runtime")
      if (runtimeRes && (runtimeRes as any).ready === false && (runtimeRes as any).error) {
        setWarnings((prev) => [...prev, String((runtimeRes as any).error)])
      }
    } catch {
      // ignore non-fatal probe error
    } finally {
      setRuntimeCheckFinished(true)
    }
  })

  const handleManualStar = async () => {
    try {
      const res = await window.api.onboardingExecuteStep("done", { action: "star" })
      if (res.status === "completed" || res.status === "reused") {
        setStarred(true)
      }
    } catch {
      // ignore
    }
  }

  const handleLaunch = async () => {
    setIsLaunching(true)
    setErrorMsg(null)
    try {
      // 3. Final Gatekeeper: Validate onboarding completion readiness
      const result = await window.api.onboardingComplete()
      if (result.status === "failed") {
        setErrorMsg(result.error?.message ?? "运行时健康检查未通过，请返回前置步骤检查配置。")
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
    <div class="ob-step-content" style={{ "text-align": "center", padding: "8px 0 0" }}>
      {/* Warm Main Greeting */}
      <div style={{ "font-size": "36px", "margin-bottom": "6px" }}>🎉</div>
      <h3 style={{ "font-size": "20px", "font-weight": "800", color: "#fff", "margin-bottom": "6px" }}>
        设置完成！
      </h3>
      <p style={{ "font-size": "13px", color: "var(--ob-text-muted)", "max-width": "480px", margin: "0 auto 14px", "line-height": "1.5" }}>
        WopalSpace 智能助手环境已全面准备就绪。点击下方按钮即可开启属于你的超级个体创作之旅。
      </p>

      {/* Warm Thank You Card — Replaces cold technical details table */}
      <div style={{
        "background": "linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%)",
        "border": "1px solid rgba(255, 255, 255, 0.08)",
        "border-radius": "8px",
        "padding": "12px 16px",
        "margin-bottom": "14px",
        "text-align": "left",
        "backdrop-filter": "blur(8px)",
      }}>
        <div style={{ "font-size": "13px", "font-weight": "600", color: "#f43f5e", "margin-bottom": "4px", display: "flex", "align-items": "center", gap: "6px" }}>
          <span>💖</span> 感谢你使用 WopalSpace
        </div>
        <div style={{ "font-size": "12px", color: "var(--ob-text-subtle)", "line-height": "1.5" }}>
          每一位创作者与超级个体都是时代独特的闪耀星光。全套 AI 智能助手与能力工具链已把关完毕，愿 WopalSpace 伴你构建卓越产品，享受纯粹的创作与构建乐趣。
        </div>
      </div>

      {/* Community Support Card — NO Auto Star */}
      <div class="ob-community-card" style={{
        "background": "rgba(255, 255, 255, 0.03)",
        "border": "1px solid rgba(255, 255, 255, 0.08)",
        "border-radius": "8px",
        "padding": "10px 14px",
        "margin-bottom": "14px",
        "text-align": "left",
        "display": "flex",
        "align-items": "center",
        "justify-content": "space-between",
      }}>
        <div>
          <div style={{ "font-weight": "600", "font-size": "13px", "margin-bottom": "2px" }}>
            ⭐ 支持 WopalSpace 开源项目
          </div>
          <div style={{ "font-size": "11px", color: "var(--ob-text-subtle)" }}>
            点亮 GitHub Star，支持团队持续交付下一代 AI 智能助手与工具链。
          </div>
        </div>
        <button
          type="button"
          class="ob-button ob-button-secondary"
          onClick={handleManualStar}
          disabled={starred()}
          style={{ "white-space": "nowrap", padding: "6px 12px", "font-size": "12px" }}
        >
          {starred() ? "已支持 ⭐" : "⭐ 点亮 Star"}
        </button>
      </div>

      {/* Warnings & Diagnostics Slot */}
      <Show when={warnings().length > 0}>
        <div style={{ "background": "rgba(255, 170, 0, 0.1)", "border": "1px solid rgba(255, 170, 0, 0.3)", "padding": "10px", "border-radius": "6px", "margin-bottom": "14px", "text-align": "left", "color": "#fcd34d", "font-size": "12px" }}>
          <div style={{ "font-weight": "600", "margin-bottom": "4px" }}>⚠️ 检查提醒：</div>
          <ul style={{ "margin": 0, "padding-left": "18px" }}>
            <For each={warnings()}>
              {(w) => <li>{w}</li>}
            </For>
          </ul>
        </div>
      </Show>

      {/* Error Message Slot */}
      <Show when={errorMsg()}>
        <div style={{ "background": "rgba(255, 68, 68, 0.1)", "border": "1px solid rgba(255, 68, 68, 0.3)", "padding": "10px", "border-radius": "6px", "margin-bottom": "14px", "text-align": "left", "color": "#ff6b6b", "font-size": "12px" }}>
          <div>❌ {errorMsg()}</div>
        </div>
      </Show>

      {/* Launch Workbench Button */}
      <div style={{ display: "flex", "justify-content": "center", "margin-top": "4px" }}>
        <button
          class="ob-button"
          style={{ padding: "10px 32px", "font-size": "15px", "font-weight": "600" }}
          onClick={handleLaunch}
          disabled={isLaunching()}
        >
          <Show when={isLaunching()} fallback={<span>🚀 启动工作台</span>}>
            <span class="ob-spinner" style={{ width: "16px", height: "16px", "border-width": "2px" }} />
            <span>正在启动…</span>
          </Show>
        </button>
      </div>
    </div>
  )
}
