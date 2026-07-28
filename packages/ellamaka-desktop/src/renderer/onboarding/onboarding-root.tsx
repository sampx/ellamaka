import { createSignal, onMount, Show, Switch, Match, For } from "solid-js"
import {
  createStepController,
  getStepMetadata,
  getStepContent,
  ONBOARDING_STEPS,
  PHASE_CONFIGS,
  getPhaseForStep,
  isOptionalStep,
  type OnboardingStepName,
} from "./step-controller"
import { SystemCheckStep } from "./steps/system-check"
import { InstallWopalCliStep } from "./steps/install-wopal-cli"
import { InstallEllamakaCliStep } from "./steps/install-ellamaka-cli"
import { OntologyGithubStep } from "./steps/ontology-github-step"
import { AiProviderStep } from "./steps/ai-provider"
import { CreateSpaceStep } from "./steps/create-space"
import { RuntimeSetupStep } from "./steps/runtime-setup"
import { MemoryConfigStep } from "./steps/memory-config"
import { DoneStep } from "./steps/done"
import { LogDrawer } from "./components/LogDrawer"
import { zhCN } from "./content/zh-CN"
import "./onboarding.css"

export interface LogEntry {
  text: string
  isError?: boolean
}

// Step categorization for nav button behavior
const FORM_SUBMIT_STEPS = new Set<OnboardingStepName>([
  "system-check",
  "install-wopal-cli",
  "install-ellamaka-cli",
  "runtime-setup",
  "github-auth",
  "ai-provider",
  "ontology-setup",
  "create-space",
  "memory-config",
])

export function OnboardingRoot() {
  const [currentStep, setCurrentStep] = createSignal<OnboardingStepName | "done">("system-check")
  const [progressMsg, setProgressMsg] = createSignal<string>("")
  const [errorInfo, setErrorInfo] = createSignal<{ code?: string; message: string; details?: string } | null>(null)
  const [logs, setLogs] = createSignal<LogEntry[]>([
    { text: "[system] 初始化 Ellamaka Onboarding 环境..." },
  ])
  const [working, setWorking] = createSignal(false)
  const [stepResult, setStepResult] = createSignal<{ success: boolean } | null>(null)
  const [hasExistingSpaces, setHasExistingSpaces] = createSignal(false)
  const [maxUnlockedPhase, setMaxUnlockedPhase] = createSignal<number>(1)

  const controller = createStepController("system-check")

  const appendLog = (text: string, isError = false) => {
    if (!text.trim()) return
    const clean = text.replace(/\x1b\[[0-9;]*m/g, "")
    setLogs((prev) => [...prev.slice(-200), { text: `[${new Date().toLocaleTimeString()}] ${clean}`, isError }])
  }

  onMount(() => {
    const unsub = window.api.onOnboardingProgress((prog) => {
      const msg = prog.message || prog.phase || ""
      if (msg) {
        setProgressMsg(msg)
        appendLog(msg, prog.phase === "failed")
      }
      if (prog.suggestion) appendLog(`建议: ${prog.suggestion}`, prog.phase === "failed")
      if (prog.details) appendLog(prog.details, prog.phase === "failed")
    })
    return unsub
  })

  const updateUnlockedPhase = (step: OnboardingStepName | "done") => {
    const p = getPhaseForStep(step).phase
    if (p > maxUnlockedPhase()) {
      setMaxUnlockedPhase(p)
    }
  }

  const handleNext = () => {
    setErrorInfo(null)
    setStepResult(null)
    controller.setCurrentStep(currentStep())
    controller.next()
    const nextStep = controller.getCurrentStep()
    setCurrentStep(nextStep)
    updateUnlockedPhase(nextStep)
    appendLog(`[step] 进入步骤: ${getStepMetadata(nextStep).title}`)
  }

  const handlePrev = () => {
    setErrorInfo(null)
    setStepResult(null)
    controller.setCurrentStep(currentStep())
    controller.prev()
    const prevStep = controller.getCurrentStep()
    setCurrentStep(prevStep)
    appendLog(`[step] 返回步骤: ${getStepMetadata(prevStep).title}`)
  }

  const handleJumpPhase = (phaseNum: 1 | 2 | 3 | 4) => {
    if (phaseNum > maxUnlockedPhase()) return
    setErrorInfo(null)
    setStepResult(null)
    const config = PHASE_CONFIGS.find((p) => p.phase === phaseNum)
    if (!config || config.steps.length === 0) return
    const target = config.steps[0]
    setCurrentStep(target)
    controller.setCurrentStep(target)
    appendLog(`[step] 切换到阶段 ${phaseNum}: ${config.title}`)
  }

  const handleSkip = async () => {
    setErrorInfo(null)
    setStepResult(null)
    const step = currentStep()
    if (step !== "done") {
      const res = await window.api.onboardingExecuteStep(step as OnboardingStepName, { skip: true })
      if (res.status === "failed") {
        handleError({ message: res.error?.message ?? "跳过失败" })
        return
      }
    }
    handleNext()
  }

  const handleError = (err: { code?: string; message: string; details?: string } | string | null) => {
    if (!err) {
      setErrorInfo(null)
      setStepResult(null)
      return
    }
    const info = typeof err === "string" ? { message: err } : err
    setErrorInfo(info)
    setStepResult({ success: false })
    appendLog(`[ERROR] ${info.message}`, true)
    if (info.details) {
      appendLog(info.details, true)
    }
  }

  const handleRetry = () => {
    setErrorInfo(null)
    setStepResult(null)
    const step = currentStep()
    if (step === "done") return
    // Trigger the step's own form submit / re-run logic
    const form = document.getElementById(`onboarding-step-${step}`)
    if (form instanceof HTMLFormElement) {
      form.requestSubmit()
    } else {
      // For steps without a form (e.g. runtime-setup wraps in a form but may not match),
      // fallback: dispatch a custom event so auto-advance steps can re-mount
      const event = new CustomEvent("ob-retry", { bubbles: true })
      document.dispatchEvent(event)
    }
  }

  const handleStepStatusChange = (status: "working" | "success" | "error") => {
    if (status === "working") {
      setWorking(true)
      setStepResult(null)
    } else if (status === "success") {
      setWorking(false)
      setStepResult({ success: true })
    } else {
      setWorking(false)
      setStepResult({ success: false })
    }
  }

  const currentPhase = () => getPhaseForStep(currentStep())
  const meta = () => getStepMetadata(currentStep())
  const content = () => getStepContent(currentStep())

  const isCurrentOptional = () => {
    const step = currentStep()
    if (step === "done") return false
    // create-space optionality is determined by the component itself (existing spaces)
    if (step === "create-space") return false
    return isOptionalStep(step as OnboardingStepName, { hasExistingSpaces: hasExistingSpaces() })
  }

  const handleCancel = async () => {
    try {
      await window.api.onboardingCancelStep()
    } catch {
      // ignore
    }
    setWorking(false)
    setStepResult({ success: false })
    appendLog("[step] 用户已取消当前操作")
  }

  // --- Navigation button state derivation ---
  const stepName = () => currentStep() as OnboardingStepName

  const isDone = () => currentStep() === "done"

  // Previous button: enabled when there is a real previous step and not working
  const prevEnabled = () => {
    if (isDone()) return true // allow going back from done
    const idx = ONBOARDING_STEPS.indexOf(stepName())
    return idx > 0 && !working()
  }

  // Retry button: visible when step failed; disabled while working
  const retryVisible = () => {
    if (isDone()) return false
    if (working()) return false
    if (stepResult()?.success === false) return true
    return false
  }

  const retryEnabled = () => !working() && !isDone()

  // Next button: hidden for done (launch is in-card)
  const nextVisible = () => {
    if (isDone()) return false
    return true
  }

  const nextEnabled = () => {
    if (working()) return false
    if (isDone()) return true
    // For form-submit steps: enabled when step succeeded (advance) or idle (submit)
    if (FORM_SUBMIT_STEPS.has(stepName())) {
      if (stepResult()?.success === true) return true // advance to next step
      if (stepResult()?.success === false) return false // need retry first
      return true // idle — submit
    }
    return false
  }

  const nextLabel = () => {
    if (stepResult()?.success === true) return "下一步"
    // Step-specific action labels for the primary submit action
    const step = stepName()
    if (step === "system-check") return "开始检查"
    if (step === "install-wopal-cli") return "安装 Wopal CLI"
    if (step === "install-ellamaka-cli") return "安装 Ellamaka"
    if (step === "runtime-setup") return "配置运行时"
    if (step === "ontology-setup") return "准备能力库"
    if (step === "ai-provider") return "保存配置"
    if (step === "create-space") return "创建工作空间"
    if (step === "memory-config") return "保存配置"
    return "下一步"
  }

  const handleNextClick = () => {
    // If step already succeeded, advance to next step directly
    if (stepResult()?.success === true) {
      handleNext()
      return
    }
    if (FORM_SUBMIT_STEPS.has(stepName())) {
      // Step not yet executed: submit the form to trigger step logic
      const form = document.getElementById(`onboarding-step-${stepName()}`)
      if (form instanceof HTMLFormElement) {
        form.requestSubmit()
      } else {
        handleNext()
      }
    } else {
      handleNext()
    }
  }

  return (
    <div class="onboarding-container">
      <div class="ob-window-chrome" />

      <header class="ob-header">
        <div class="ob-brand">
          <img src="/ellamaka-text-logo.png?v=2" class="ob-brand-logo" alt="Ellamaka Logo" onError={(e) => (e.currentTarget.style.display = "none")} />
          <span style={{ "font-weight": "700", "font-size": "15px", color: "#fff" }}>WopalSpace 设置</span>
        </div>

        {/* 4-Phase Tracker Bar */}
        <div class="ob-tracker">
          <For each={PHASE_CONFIGS}>
            {(phaseConfig) => {
              const isActive = () => currentPhase().phase === phaseConfig.phase
              const isPast = () => currentPhase().phase > phaseConfig.phase
              const isLocked = () => phaseConfig.phase > maxUnlockedPhase()
              return (
                <button
                  class={`ob-step-nav-pill ${isActive() ? "active" : ""} ${isPast() ? "completed" : ""} ${isLocked() ? "locked" : ""}`}
                  onClick={() => handleJumpPhase(phaseConfig.phase)}
                  disabled={isLocked() || working()}
                  title={isLocked() ? `阶段 ${phaseConfig.phase}: 完成前置阶段后解锁` : `阶段 ${phaseConfig.phase}: ${phaseConfig.title}`}
                >
                  <span>
                    {isLocked() ? "🔒 " : isPast() ? "✓ " : ""}{phaseConfig.phase}. {phaseConfig.title}
                  </span>
                </button>
              )
            }}
          </For>
        </div>
      </header>

      <main class="ob-main-wrapper">
        <div class="ob-main-content">
          <div class="ob-wizard-stage">
            <div class="ob-grid-layout">
              {/* Left: Phase Info */}
              <div class="ob-step-info">
                <div class="ob-step-info-card">
                  <div class="ob-step-number">阶段 {currentPhase().phase} / 4</div>
                  <h3 class="ob-step-info-title">{currentPhase().title}</h3>
                  <p class="ob-step-info-goal">{content()?.goal ?? meta().description}</p>

                  <Show when={content()?.why}>
                    <div class="ob-step-info-section">
                      <div class="ob-step-info-label">为什么需要这一步</div>
                      <p class="ob-step-info-text">{content()?.why}</p>
                    </div>
                  </Show>

                  <Show when={content()?.duration}>
                    <div class="ob-step-info-section">
                      <div class="ob-step-info-label">预计耗时</div>
                      <p class="ob-step-info-text">{content()?.duration}</p>
                    </div>
                  </Show>
                </div>
              </div>

              {/* Right: Card View */}
              <div class="ob-card">
                <div class="ob-card-header">
                  <h2 class="ob-card-title">{meta().title}</h2>
                  <Show when={isCurrentOptional()}>
                    <span class="ob-optional-tag">可选</span>
                  </Show>
                </div>
                <p class="ob-mobile-step-summary">{content()?.goal ?? meta().description}</p>

                <Show when={errorInfo()}>
                  <div class="ob-feedback-slot">
                    <div class="ob-error-banner" role="alert">
                      <div class="ob-error-indicator">!</div>
                      <div class="ob-error-text">
                        <div class="ob-error-heading">
                          <span class="ob-error-title">当前步骤未完成</span>
                          <Show when={errorInfo()?.code}>
                            <code class="ob-error-code">{errorInfo()?.code}</code>
                          </Show>
                        </div>
                        <div class="ob-error-message">{errorInfo()?.message}</div>
                      </div>
                      <button type="button" class="ob-error-close" aria-label="关闭错误提示" onClick={() => setErrorInfo(null)}>×</button>
                    </div>
                  </div>
                </Show>

                {/* Card Body - Scrollable */}
                <div class="ob-card-body">
                  <Switch>
                    {/* Phase 1 Steps - rendered directly so currentStep reflects sub-step */}
                    <Match when={currentStep() === "system-check"}>
                      <SystemCheckStep
                        onComplete={handleNext}
                        onError={handleError}
                        onStatusChange={handleStepStatusChange}
                      />
                    </Match>
                    <Match when={currentStep() === "install-wopal-cli"}>
                      <InstallWopalCliStep
                        onComplete={handleNext}
                        onError={handleError}
                        onStatusChange={handleStepStatusChange}
                      />
                    </Match>
                    <Match when={currentStep() === "install-ellamaka-cli"}>
                      <InstallEllamakaCliStep
                        onComplete={handleNext}
                        onError={handleError}
                        onStatusChange={handleStepStatusChange}
                      />
                    </Match>

                    {/* Phase 2 Steps */}
                    <Match when={currentStep() === "ontology-setup" || currentStep() === "github-auth"}>
                      <OntologyGithubStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                    </Match>
                    <Match when={currentStep() === "ai-provider"}>
                      <AiProviderStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                    </Match>

                    {/* Phase 3 Steps */}
                    <Match when={currentStep() === "runtime-setup"}>
                      <RuntimeSetupStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                    </Match>
                    <Match when={currentStep() === "create-space"}>
                      <CreateSpaceStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                    </Match>
                    <Match when={currentStep() === "memory-config"}>
                      <MemoryConfigStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                    </Match>

                    {/* Phase 4 Steps */}
                    <Match when={currentStep() === "done" || currentStep() === "star-guide"}>
                      <DoneStep />
                    </Match>
                  </Switch>
                </div>

                {/* Fixed Navigation Bar — always visible at card bottom */}
                <div class="ob-fixed-nav">
                  <button
                    type="button"
                    class="ob-button ob-button-secondary ob-nav-prev"
                    onClick={handlePrev}
                    disabled={!prevEnabled()}
                  >
                    上一步
                  </button>

                  <div class="ob-fixed-nav-center">
                    <Show when={isCurrentOptional() && !working() && stepResult()?.success !== true}>
                      <button
                        type="button"
                        class="ob-button ob-button-secondary"
                        onClick={handleSkip}
                      >
                        {currentStep() === "memory-config" ? zhCN.actions.disableMemory : "跳过本步骤"}
                      </button>
                    </Show>
                  </div>

                  <Show when={working()}>
                    <button
                      type="button"
                      class="ob-button ob-button-secondary ob-nav-stop"
                      onClick={handleCancel}
                    >
                      停止
                    </button>
                  </Show>

                  <Show when={!working() && retryVisible()}>
                    <button
                      type="button"
                      class="ob-button ob-retry-button"
                      onClick={handleRetry}
                      disabled={!retryEnabled()}
                    >
                      重试
                    </button>
                  </Show>

                  <Show when={!working() && nextVisible()}>
                    <button
                      type="button"
                      class="ob-button ob-nav-next"
                      onClick={handleNextClick}
                      disabled={!nextEnabled()}
                    >
                      {nextLabel()}
                    </button>
                  </Show>
                </div>
              </div>
            </div>
          </div>

          <LogDrawer logs={logs()} onClear={() => setLogs([])} />
        </div>
      </main>

      <footer class="ob-footer">
        <div>WopalSpace &copy; 2026</div>
        <div class="ob-footer-status">{progressMsg() || "系统就绪"}</div>
        <div class="ob-footer-version">v1.15.13</div>
      </footer>
    </div>
  )
}