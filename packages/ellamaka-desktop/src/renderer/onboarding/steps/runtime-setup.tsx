import { createSignal, For, onMount, Show } from "solid-js"
import { ProgressDisplay } from "../components/ProgressDisplay"
import {
  normalizeRuntimeInspection,
  runRuntimeSetupFlow,
  type RuntimePhase,
  type RuntimeSetupFlowOutcome,
  type RuntimeStepResponse,
} from "./runtime-setup-flow"

export interface StepProps {
  onStatusChange?: (status: "working" | "success" | "error") => void
  onComplete: () => void
  onError: (msg: string | null) => void
}

export function RuntimeSetupStep(props: StepProps) {
  const [isExecuting, setIsExecuting] = createSignal(true)
  const [phase, setPhase] = createSignal<RuntimePhase>("checking")
  const [wasReady, setWasReady] = createSignal(false)
  const [outcome, setOutcome] = createSignal<RuntimeSetupFlowOutcome | null>(null)

  const prepareRuntime = async () => {
    props.onError(null)
    props.onStatusChange?.("working")
    setIsExecuting(true)
    setOutcome(null)
    try {
      const next = await runRuntimeSetupFlow({
        probe: async () => normalizeRuntimeInspection(await window.api.onboardingProbe("runtime")),
        reconcile: async () => await window.api.onboardingExecuteStep("runtime-setup") as RuntimeStepResponse,
        onPhase: (nextPhase, inspection) => {
          setPhase(nextPhase)
          if (nextPhase === "configuring") setWasReady(Boolean(inspection?.ready))
        },
      })
      setOutcome(next)
      props.onStatusChange?.("success")
    } catch (err) {
      props.onStatusChange?.("error")
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsExecuting(false)
    }
  }

  onMount(() => {
    void prepareRuntime()
  })

  const capStatus = (status?: string) => {
    if (status === "created") return "已安装"
    if (status === "repaired") return "已修复"
    if (status === "reused") return "已复用"
    if (status === "skipped") return "已跳过"
    if (status === "failed") return "失败"
    return "已就绪"
  }

  const phaseLabel = () => {
    if (phase() === "checking") return "正在检查 WOPAL_HOME 中的本体能力…"
    if (phase() === "verifying") return "正在复检本体能力配置…"
    return wasReady() ? "正在确认现有本体能力配置…" : "正在安装配置本体能力…"
  }

  const result = () => outcome()?.response.result
  const inspection = () => outcome()?.after

  return (
    <form
      id="onboarding-step-runtime-setup"
      class="ob-step-content"
      onSubmit={(event) => {
        event.preventDefault()
        void prepareRuntime()
      }}
    >
      <Show when={isExecuting()}>
        <ProgressDisplay phase={phaseLabel()} />
      </Show>

      <Show when={!isExecuting() && outcome()}>
        <div class="ob-result-summary">
          <div class="ob-result-icon">✓</div>
          <div class="ob-result-title">
            {outcome()?.response.status === "reused" ? "本体能力配置已复用" : "本体能力已安装配置"}
          </div>

          <div class="ob-result-details">
            <div class="ob-result-row">
              <span class="ob-result-label">WOPAL_HOME</span>
              <span class="ob-result-value ob-result-mono">{inspection()?.homePath ?? "已配置"}</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">设置文件</span>
              <span class="ob-result-value ob-result-mono">
                {result()?.settingsPath ?? inspection()?.settingsPath ?? "已配置"}
              </span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">辅助脚本</span>
              <span class="ob-result-value">
                {(result()?.scripts?.synced?.length ?? 0) > 0
                  ? `${result()?.scripts?.synced?.length} 项已同步`
                  : "现有配置已复用"}
                <Show when={(result()?.scripts?.warnings?.length ?? 0) > 0}>
                  <span class="ob-result-warning">（{result()?.scripts?.warnings?.length} 项警告）</span>
                </Show>
              </span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">基础能力</span>
              <span class="ob-result-value">
                {result()?.capabilities?.length ?? inspection()?.capabilities?.present?.length ?? 0} 类已就绪
              </span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">复检结果</span>
              <span class="ob-result-value">通过</span>
            </div>
          </div>

          <Show when={(result()?.capabilities?.length ?? 0) > 0}>
            <div class="ob-capability-grid">
              <For each={result()?.capabilities ?? []}>
                {(cap) => (
                  <div class="ob-capability-item">
                    <span class="ob-capability-name">{cap.capability}</span>
                    <span class={`ob-capability-status ob-capability-${cap.status}`}>{capStatus(cap.status)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>

        </div>
      </Show>

      <Show when={!isExecuting() && !outcome()}>
        <div class="ob-result-summary">
          <div class="ob-result-icon ob-result-error">✗</div>
          <div class="ob-result-title">本体能力安装配置未完成</div>
        </div>
      </Show>
    </form>
  )
}
