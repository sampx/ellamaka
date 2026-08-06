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
      class="ob-syscheck-content"
      onSubmit={handleSubmit}
    >
      {/* 1. Warm Greeting Header */}
      <div class="ob-syscheck-hero">
        <div class="ob-syscheck-emoji">👋</div>
        <h3 class="ob-syscheck-title">
          {props.userName ? `嗨，${props.userName}！欢迎来到 WopalSpace` : "欢迎来到 WopalSpace"}
        </h3>
      </div>

      {/* 2. Environment Inspection Card */}
      <div class="ob-syscheck-card">
        <div class="ob-result-row">
          <span class="ob-result-label">系统架构</span>
          <span class="ob-result-value">{sysInfo().platform || "darwin"} ({sysInfo().arch || "arm64"})</span>
        </div>
        <div class="ob-result-row">
          <span class="ob-result-label">Git</span>
          <span class="ob-result-value">{sysInfo().gitVer || "已准备"}</span>
        </div>
        <div class="ob-result-row">
          <span class="ob-result-label">环境准备状态</span>
          <span class={`ob-result-value ob-syscheck-status ${!isRunning() && isPassed() ? "ready" : ""}`}>
            <Show when={isRunning()}>
              <span class="ob-syscheck-spinner" />
              <span>检查中…</span>
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

      {/* 3. Working Directory Card */}
      <div class="ob-syscheck-card">
        <label class="ob-syscheck-home-label" for="syscheck-home-input">工作主目录 (WOPAL_HOME)</label>
        <input
          id="syscheck-home-input"
          type="text"
          class="ob-input ob-syscheck-home-input"
          value={wopalHome()}
          onInput={(e) => handleInputChange(e.currentTarget.value)}
          placeholder="~/.wopal"
          disabled={isRunning()}
        />
        <button
          type="button"
          class="ob-button ob-button-secondary ob-syscheck-browse"
          onClick={handleBrowseHome}
          disabled={isRunning()}
        >
          <span>📁</span>
          <span>选择 / 更改工作目录…</span>
        </button>
      </div>

      <Show when={!isRunning() && errorMsg()}>
        <div class="ob-syscheck-error">
          <span class="ob-syscheck-error-icon">✗</span>
          <div>
            <div class="ob-syscheck-error-title">环境检查未通过</div>
            <div class="ob-syscheck-error-message">{errorMsg()}</div>
          </div>
        </div>
      </Show>
    </form>
  )
}
