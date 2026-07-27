import { createSignal, onMount, Show } from "solid-js"
import { ProgressDisplay } from "../components/ProgressDisplay"

export interface StepProps {
  onStatusChange?: (status: "working" | "success" | "error") => void
  onComplete: () => void
  onError: (msg: string | null) => void
}

export function InstallEllamakaCliStep(props: StepProps) {
  const [isExecuting, setIsExecuting] = createSignal<boolean>(true)
  const [isPassed, setIsPassed] = createSignal<boolean>(false)
  const [info, setInfo] = createSignal<{ version?: string; binaryPath?: string; channel?: string }>({})
  const [progress, setProgress] = createSignal<{ phase?: string; percent?: number }>({})

  const runInstall = async (forceUpgrade = false) => {
    props.onError(null)
    props.onStatusChange?.("working")
    setIsExecuting(true)
    setIsPassed(false)
    setProgress({ phase: "正在安装 Ellamaka 引擎…" })
    try {
      const res = await window.api.onboardingExecuteStep("install-ellamaka-cli", { forceUpgrade })
      if (res.status === "completed" || res.status === "reused") {
        setIsPassed(true)
        props.onStatusChange?.("success")
        const resData = res.result as { version?: string; binaryPath?: string; channel?: string }
        setInfo({
          version: resData?.version,
          binaryPath: resData?.binaryPath,
          channel: resData?.channel,
        })
      } else {
        props.onStatusChange?.("error")
        props.onError(res.error?.message ?? "Ellamaka 引擎安装失败。")
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
      id="onboarding-step-install-ellamaka-cli"
      class="ob-step-content"
      onSubmit={(event) => {
        event.preventDefault()
        void runInstall(true)
      }}
    >
      <Show when={isExecuting()}>
        <ProgressDisplay phase={progress().phase} percent={progress().percent} />
      </Show>

      <Show when={!isExecuting() && isPassed()}>
        <div class="ob-result-summary">
          <div class="ob-result-icon">✓</div>
          <div class="ob-result-title">Ellamaka 引擎已就绪</div>

          <div class="ob-result-details">
            <Show when={info().version}>
              <div class="ob-result-row">
                <span class="ob-result-label">版本</span>
                <span class="ob-result-value">{info().version}</span>
              </div>
            </Show>
            <Show when={info().channel}>
              <div class="ob-result-row">
                <span class="ob-result-label">Channel</span>
                <span class="ob-result-value">{info().channel}</span>
              </div>
            </Show>
            <Show when={info().binaryPath}>
              <div class="ob-result-row">
                <span class="ob-result-label">路径</span>
                <span class="ob-result-value ob-result-mono">{info().binaryPath}</span>
              </div>
            </Show>
          </div>

        </div>
      </Show>

      <Show when={!isExecuting() && !isPassed()}>
        <div class="ob-result-summary">
          <div class="ob-result-icon ob-result-error">✗</div>
          <div class="ob-result-title">安装未完成</div>
        </div>
      </Show>
    </form>
  )
}
