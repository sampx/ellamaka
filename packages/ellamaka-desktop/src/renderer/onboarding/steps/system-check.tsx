import { createSignal, onMount, Show } from "solid-js"

export interface StepProps {
  userName?: string
  onComplete: () => void
  onError: (msg: string | null) => void
  onStatusChange?: (status: "working" | "success" | "error") => void
}

export function SystemCheckStep(props: StepProps) {
  const [isRunning, setIsRunning] = createSignal<boolean>(true)
  const [isPassed, setIsPassed] = createSignal<boolean>(false)
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null)
  const [wopalHome, setWopalHome] = createSignal<string>("")
  const [sysInfo, setSysInfo] = createSignal<{
    platform?: string
    arch?: string
    nodeVer?: string
    gitVer?: string
  }>({})

  const runCheck = async (targetPath?: string) => {
    props.onError(null)
    props.onStatusChange?.("working")
    setIsRunning(true)
    setIsPassed(false)
    setErrorMsg(null)
    const checkHome = targetPath ?? wopalHome()
    try {
      const res = await window.api.onboardingExecuteStep("system-check", {
        customHomePath: checkHome || undefined,
      })
      if (res.status === "completed" || res.status === "reused") {
        setIsPassed(true)
        props.onStatusChange?.("success")
        const data = (res.result as Record<string, string>) || {}
        setSysInfo({
          platform: data.platform || "darwin",
          arch: data.arch || "arm64",
          nodeVer: data.embeddedNodeVersion || data.nodeVersion || "v24.x",
          gitVer: data.gitVersion || data.gitStatus || "git version 2.x",
        })
        if (data.wopalHome) {
          setWopalHome(data.wopalHome)
        }
      } else {
        const msg = res.error?.message ?? "系统环境检查失败。"
        setErrorMsg(msg)
        props.onStatusChange?.("error")
        props.onError(msg)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      props.onStatusChange?.("error")
      props.onError(msg)
    } finally {
      setIsRunning(false)
    }
  }

  onMount(async () => {
    props.onStatusChange?.("working")
    setIsRunning(true)
    let home = wopalHome()
    try {
      const probeRes = await window.api.onboardingProbe("home")
      const realHome = (probeRes as any)?.homePath || (probeRes as any)?.wopalHome
      if (realHome) {
        home = realHome
        setWopalHome(realHome)
      }
    } catch {
      // ignore probe error
    }
    await runCheck(home || undefined)
  })

  const handleBrowseHome = async () => {
    try {
      const result = await window.api.openDirectoryPicker({
        title: "选择 WOPAL_HOME 工作目录",
        defaultPath: wopalHome() || "~/.wopal",
      })
      const selected = typeof result === "string" ? result : Array.isArray(result) ? result[0] : null
      if (selected) {
        setWopalHome(selected)
        setIsPassed(false)
        await window.api.onboardingSetWopalHome(selected)
        void runCheck(selected)
      }
    } catch {
      // ignore dialog cancel
    }
  }

  const handleSubmit = (event: Event) => {
    event.preventDefault()
    if (isRunning()) return
    props.onComplete()
  }

  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  const handleInputChange = (val: string) => {
    setWopalHome(val)
    setIsPassed(false)
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      const trimmed = val.trim()
      if (trimmed) {
        await window.api.onboardingSetWopalHome(trimmed)
        void runCheck(trimmed)
      }
    }, 400)
  }

  return (
    <form
      id="onboarding-step-system-check"
      class="ob-step-content"
      onSubmit={handleSubmit}
    >
      {/* 1. Warm Greeting Header (Clean, zero overlap, compact) */}
      <div style={{ "text-align": "center" }}>
        <div style={{ "font-size": "36px", "margin-bottom": "6px", "line-height": "1" }}>👋</div>
        <h3 style={{ "font-size": "20px", "font-weight": "800", color: "#ffffff", margin: 0, "letter-spacing": "-0.01em" }}>
          {props.userName ? `嗨，${props.userName}！欢迎来到 WopalSpace` : "欢迎来到 WopalSpace"}
        </h3>
      </div>

      {/* 2. Environment Inspection Panel */}
      <div class="ob-result-summary">
        {/* Top Section: Environment Readiness Grid */}
        <div class="ob-result-details" style={{ margin: 0, "padding-bottom": "14px", "border-bottom": "1px dashed var(--ob-border, rgba(255,255,255,0.1))" }}>
          <div class="ob-result-row" style={{ padding: "4px 0" }}>
            <span class="ob-result-label" style={{ "font-size": "13px" }}>系统架构</span>
            <span class="ob-result-value" style={{ "font-size": "13px" }}>{sysInfo().platform || "darwin"} ({sysInfo().arch || "arm64"})</span>
          </div>
          <div class="ob-result-row" style={{ padding: "4px 0" }}>
            <span class="ob-result-label" style={{ "font-size": "13px" }}>Git</span>
            <span class="ob-result-value" style={{ "font-size": "13px" }}>{sysInfo().gitVer || "已准备"}</span>
          </div>
          <div class="ob-result-row" style={{ padding: "4px 0" }}>
            <span class="ob-result-label" style={{ "font-size": "13px" }}>环境准备状态</span>
            <span class="ob-result-value ob-result-accent" style={{ display: "inline-flex", "align-items": "center", gap: "6px", "font-size": "13px" }}>
              <Show when={isRunning()}>
                <span style={{ display: "inline-block", width: "8px", height: "8px", "border-radius": "50%", background: "var(--ob-accent, #ff6f61)", animation: "ob-spin 1s linear infinite" }} />
                <span>检查中...</span>
              </Show>
              <Show when={!isRunning() && isPassed()}>
                <span>✓ 基础环境检测就绪</span>
              </Show>
              <Show when={!isRunning() && !isPassed()}>
                <span>等待确认</span>
              </Show>
            </span>
          </div>
        </div>

        {/* Bottom Section: Working Directory Picker Box */}
        <div>
          <label class="ob-label" style={{ "font-size": "12px", "font-weight": "500", color: "var(--ob-text-subtle, #94a3b8)", "margin-bottom": "6px", display: "block" }}>
            工作主目录 (WOPAL_HOME)
          </label>

          <input
            type="text"
            class="ob-input"
            style={{ width: "100%", "font-family": "monospace", "font-size": "13px", color: "var(--ob-accent, #3b82f6)", background: "rgba(0,0,0,0.25)", padding: "8px 12px", "border-radius": "8px", "box-sizing": "border-box" }}
            value={wopalHome()}
            onInput={(e) => handleInputChange(e.currentTarget.value)}
            placeholder="~/.wopal"
            disabled={isRunning()}
          />

          <div style={{ "margin-top": "8px", display: "flex", "justify-content": "flex-start" }}>
            <button
              type="button"
              class="ob-button ob-button-secondary"
              onClick={handleBrowseHome}
              disabled={isRunning()}
              style={{ "font-size": "12px", padding: "6px 14px", display: "flex", "align-items": "center", gap: "6px", "border-radius": "6px" }}
            >
              <span>📁</span>
              <span>选择 / 更改工作目录...</span>
            </button>
          </div>
        </div>
      </div>

      <Show when={!isRunning() && errorMsg()}>
        <div class="ob-result-summary">
          <div class="ob-result-icon ob-result-error">✗</div>
          <div class="ob-result-title" style={{ "font-size": "13px" }}>环境检查未通过</div>
          <div class="ob-result-subtitle" style={{ "font-size": "12px" }}>{errorMsg()}</div>
        </div>
      </Show>
    </form>
  )
}
