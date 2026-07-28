import { createSignal, onMount, Show } from "solid-js"
import { ProgressDisplay } from "../components/ProgressDisplay"

export interface StepProps {
  onComplete: () => void
  onError: (msg: string | null) => void
  onStatusChange?: (status: "working" | "success" | "error") => void
}

export function SystemCheckStep(props: StepProps) {
  const [isRunning, setIsRunning] = createSignal<boolean>(false)
  const [isPassed, setIsPassed] = createSignal<boolean>(false)
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null)
  const [wopalHome, setWopalHome] = createSignal<string>("")
  const [sysInfo, setSysInfo] = createSignal<{
    platform?: string
    arch?: string
    nodeVer?: string
    gitVer?: string
    networkStatus?: string
  }>({})

  const runCheck = async () => {
    props.onError(null)
    props.onStatusChange?.("working")
    setIsRunning(true)
    setIsPassed(false)
    setErrorMsg(null)
    try {
      const res = await window.api.onboardingExecuteStep("system-check", {
        customHomePath: wopalHome() || undefined,
      })
      if (res.status === "completed" || res.status === "reused") {
        setIsPassed(true)
        props.onStatusChange?.("success")
        const data = (res.result as Record<string, string>) || {}
        setSysInfo({
          platform: data.platform || process.platform || "darwin",
          arch: data.arch || process.arch || "arm64",
          nodeVer: data.embeddedNodeVersion || data.nodeVersion || "v24.x",
          gitVer: data.gitVersion || data.gitStatus || "git version 2.x",
          networkStatus: data.networkStatus || "Connected (R2 CDN Reachable)",
        })
        if (!wopalHome()) {
          setWopalHome(data.wopalHome || "")
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
    try {
      const envRes = await window.api.onboardingProbe("environment")
      const home = (envRes as any)?.wopalHome || "~/.wopal"
      setWopalHome(home)
    } catch {
      setWopalHome("~/.wopal")
    }
  })

  const handleBrowseHome = async () => {
    try {
      const result = await window.api.openDirectoryPicker({
        title: "选择 WOPAL_HOME 工作目录",
        defaultPath: wopalHome(),
      })
      const selected = typeof result === "string" ? result : Array.isArray(result) ? result[0] : null
      if (selected) {
        setWopalHome(selected)
        setIsPassed(false)
        await window.api.onboardingSetWopalHome(selected)
      }
    } catch {
      // ignore dialog cancel
    }
  }

  const handleSubmit = (event: Event) => {
    event.preventDefault()
    if (isPassed()) {
      props.onComplete()
    } else {
      void runCheck()
    }
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
      }
    }, 300)
  }

  return (
    <form
      id="onboarding-step-system-check"
      class="ob-step-content"
      onSubmit={handleSubmit}
    >
      <div class="ob-form-group" style={{ "margin-bottom": "20px" }}>
        <label class="ob-label">WOPAL_HOME 工作主目录确认</label>
        <div class="ob-input-row" style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            class="ob-input"
            style={{ flex: 1 }}
            value={wopalHome()}
            onInput={(e) => handleInputChange(e.currentTarget.value)}
            placeholder="~/.wopal"
            disabled={isRunning()}
          />
          <button
            type="button"
            class="ob-button ob-button-secondary"
            onClick={handleBrowseHome}
            disabled={isRunning()}
            style={{ padding: "0 14px", "white-space": "nowrap", "font-size": "13px" }}
          >
            更改目录
          </button>
        </div>
        <p style={{ "font-size": "12px", color: "var(--ob-text-subtle)", "margin-top": "6px" }}>
          该目录将存储全局 CLI、引擎二进制、能力本体库以及运行时配置。设置完成后将自动写入环境变量。
        </p>
      </div>

      <Show when={isRunning()}>
        <ProgressDisplay phase="正在检查系统环境与目录可写性…" />
      </Show>

      <Show when={!isRunning() && isPassed()}>
        <div style={{ "margin-top": "14px", "padding": "10px 14px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.3)", "border-radius": "8px", color: "#34d399", "font-size": "13px", display: "flex", "align-items": "center", gap: "8px" }}>
          <span>✓</span>
          <span>系统环境与目录可写性检查通过</span>
        </div>
      </Show>

      <Show when={!isRunning() && Boolean(errorMsg())}>
        <div style={{ "margin-top": "14px", "padding": "10px 14px", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.3)", "border-radius": "8px", color: "#f87171", "font-size": "13px" }}>
          <div style={{ "font-weight": "600", "margin-bottom": "4px" }}>✗ 检查未通过：</div>
          <div>{errorMsg()}</div>
        </div>
      </Show>

    </form>
  )
}
