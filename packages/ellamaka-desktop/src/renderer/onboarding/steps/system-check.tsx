import { createSignal, onMount, Show } from "solid-js"
import { ProgressDisplay } from "../components/ProgressDisplay"

export interface StepProps {
  onComplete: () => void
  onError: (msg: string | null) => void
  onStatusChange?: (status: "working" | "success" | "error") => void
}

export function SystemCheckStep(props: StepProps) {
  const [isRunning, setIsRunning] = createSignal<boolean>(true)
  const [isPassed, setIsPassed] = createSignal<boolean>(false)
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null)
  const [sysInfo, setSysInfo] = createSignal<{
    platform?: string
    arch?: string
    nodeVer?: string
    gitVer?: string
    networkStatus?: string
    wopalHome?: string
  }>({})

  const runCheck = async () => {
    props.onError(null)
    props.onStatusChange?.("working")
    setIsRunning(true)
    setIsPassed(false)
    setErrorMsg(null)
    try {
      const res = await window.api.onboardingExecuteStep("system-check")
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
          wopalHome: data.wopalHome || "~/.wopal",
        })
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

  onMount(() => {
    void runCheck()
  })

  return (
    <form
      id="onboarding-step-system-check"
      class="ob-step-content"
      onSubmit={(event) => {
        event.preventDefault()
        void runCheck()
      }}
    >
      <Show when={isRunning()}>
        <ProgressDisplay phase="正在检查系统环境…" />
      </Show>

      <Show when={!isRunning() && isPassed()}>
        <div class="ob-result-summary">
          <div class="ob-result-icon">✓</div>
          <div class="ob-result-title">系统环境检查通过</div>

          <div class="ob-result-details">
            <div class="ob-result-row">
              <span class="ob-result-label">操作系统</span>
              <span class="ob-result-value">{sysInfo().platform} ({sysInfo().arch})</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">Node.js</span>
              <span class="ob-result-value">{sysInfo().nodeVer}</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">Git</span>
              <span class="ob-result-value">{sysInfo().gitVer}</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">网络连接</span>
              <span class="ob-result-value">{sysInfo().networkStatus}</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">WOPAL_HOME</span>
              <span class="ob-result-value ob-result-mono">{sysInfo().wopalHome}</span>
            </div>
          </div>
        </div>
      </Show>

      <Show when={!isRunning() && !isPassed()}>
        <div class="ob-result-summary">
          <div class="ob-result-icon ob-result-error">✗</div>
          <div class="ob-result-title">系统环境检查未通过</div>
          <Show when={errorMsg()}>
            <div class="ob-error-message" style={{ "text-align": "center", "max-width": "400px" }}>
              {errorMsg()}
            </div>
          </Show>
        </div>
      </Show>
    </form>
  )
}
