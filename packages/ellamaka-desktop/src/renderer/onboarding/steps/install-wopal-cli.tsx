import { createSignal, onMount, Show } from "solid-js"
import { ProgressDisplay } from "../components/ProgressDisplay"

export interface StepProps {
  onStatusChange?: (status: "working" | "success" | "error") => void
  onComplete: () => void
  onError: (msg: string | null) => void
}

export function InstallWopalCliStep(props: StepProps) {
  const [isExecuting, setIsExecuting] = createSignal<boolean>(true)
  const [isPassed, setIsPassed] = createSignal<boolean>(false)
  const [versionInfo, setVersionInfo] = createSignal<{ local?: string; latest?: string; binaryPath?: string }>({})
  const [progress, setProgress] = createSignal<{ phase?: string; percent?: number }>({})

  const runInstall = async (forceUpgrade = false) => {
    props.onError(null)
    props.onStatusChange?.("working")
    setIsExecuting(true)
    setIsPassed(false)
    setProgress({ phase: "检查 Wopal CLI 版本…" })
    try {
      const res = await window.api.onboardingExecuteStep("install-wopal-cli", { forceUpgrade })
      if (res.status === "completed" || res.status === "reused") {
        setIsPassed(true)
        props.onStatusChange?.("success")
        const resData = res.result as { version?: string; latestVersion?: string; binaryPath?: string }
        if (resData) {
          setVersionInfo({
            local: resData.version,
            latest: resData.latestVersion,
            binaryPath: resData.binaryPath,
          })
        }
      } else {
        props.onStatusChange?.("error")
        props.onError(res.error?.message ?? "Wopal CLI 安装或升级失败。")
      }
    } catch (err) {
      props.onStatusChange?.("error")
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsExecuting(false)
    }
  }

  onMount(() => {
    void runInstall()
  })

  return (
    <form
      id="onboarding-step-install-wopal-cli"
      class="ob-step-content"
      onSubmit={(event) => {
        event.preventDefault()
        if (isPassed()) {
          props.onComplete()
          return
        }
        void runInstall(true)
      }}
    >
      <Show when={isExecuting()}>
        <ProgressDisplay phase={progress().phase} percent={progress().percent} />
      </Show>

      <Show when={!isExecuting() && isPassed()}>
        <div class="ob-result-summary">
          <div class="ob-result-icon">✓</div>
          <div class="ob-result-title">Wopal CLI 已就绪</div>

          <div class="ob-result-details">
            <div class="ob-result-row">
              <span class="ob-result-label">版本</span>
              <span class="ob-result-value">{versionInfo().local || "已安装"}</span>
            </div>
            <Show when={versionInfo().latest}>
              <div class="ob-result-row">
                <span class="ob-result-label">最新版本</span>
                <span class="ob-result-value ob-result-accent">{versionInfo().latest}</span>
              </div>
            </Show>
            <Show when={versionInfo().binaryPath}>
              <div class="ob-result-row">
                <span class="ob-result-label">路径</span>
                <span class="ob-result-value ob-result-mono">{versionInfo().binaryPath}</span>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={!isExecuting() && !isPassed()}>
        <div class="ob-result-summary">
          <div class="ob-result-icon ob-result-error">✗</div>
          <div class="ob-result-title">安装未完成</div>
          <div class="ob-result-subtitle">请查看上方错误信息了解详情</div>
        </div>
      </Show>
    </form>
  )
}
