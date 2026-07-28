import { createSignal, For, Show } from "solid-js"
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
  const [isExecuting, setIsExecuting] = createSignal(false)
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

  const phaseLabel = () => {
    if (phase() === "checking") return "正在检查 WOPAL_HOME 中的能力配置…"
    if (phase() === "verifying") return "正在复检能力配置…"
    return wasReady() ? "正在确认现有能力配置…" : "正在物化基础能力与工具…"
  }

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

      <Show when={!isExecuting() && !outcome()}>
        <div class="ob-result-summary">
          <div class="ob-result-title">点击「配置运行时」开始</div>
          <div class="ob-result-subtitle">将检查并物化 WOPAL_HOME 中的基础能力与工具</div>
        </div>
      </Show>

      <Show when={!isExecuting() && outcome()}>
        <div class="ob-result-summary">
          <div class="ob-result-icon">✓</div>
          <div class="ob-result-title">运行时已就绪</div>
        </div>
      </Show>
    </form>
  )
}
