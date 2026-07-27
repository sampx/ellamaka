import { createSignal, onMount, Show, Switch, Match, For } from "solid-js"
import { createStepController, getStepMetadata, getStepContent, isExplicitActionStep, ONBOARDING_STEPS, resolveFeedbackMode, resolveForwardMode, type OnboardingStepName } from "./step-controller"
import { SystemCheckStep } from "./steps/system-check"
import { InstallWopalCliStep } from "./steps/install-wopal-cli"
import { InstallEllamakaCliStep } from "./steps/install-ellamaka-cli"
import { GithubAuthStep } from "./steps/github-auth"
import { AiProviderStep } from "./steps/ai-provider"
import { CreateSpaceStep } from "./steps/create-space"
import { OntologySetupStep } from "./steps/ontology-setup"
import { RuntimeSetupStep } from "./steps/runtime-setup"
import { MemoryConfigStep } from "./steps/memory-config"
import { StarGuideStep } from "./steps/star-guide"
import { DoneStep } from "./steps/done"
import { LogDrawer } from "./components/LogDrawer"
import { zhCN } from "./content/zh-CN"
import "./onboarding.css"

export interface LogEntry {
  text: string
  isError?: boolean
}

export function OnboardingRoot() {
  const [currentStep, setCurrentStep] = createSignal<OnboardingStepName | "done">("system-check")
  const [progressMsg, setProgressMsg] = createSignal<string>("")
  const [errorInfo, setErrorInfo] = createSignal<{ code?: string; message: string; details?: string } | null>(null)
  const [logs, setLogs] = createSignal<LogEntry[]>([
    { text: "[system] 初始化 Ellamaka Onboarding 环境..." },
  ])
  const [working, setWorking] = createSignal(false)
  const [stepResult, setStepResult] = createSignal<{ success: boolean } | null>(null)

  const controller = createStepController("system-check")

  const appendLog = (text: string, isError = false) => {
    if (!text.trim()) return
    const clean = text.replace(/\x1b\[[0-9;]*m/g, "")
    setLogs((prev) => [...prev.slice(-200), { text: `[${new Date().toLocaleTimeString()}] ${clean}`, isError }])
  }

  const syncState = async () => {
    try {
      const state = await window.api.onboardingGetState()
      if (state && state.currentStep) {
        setCurrentStep(state.currentStep)
        controller.setCurrentStep(state.currentStep)
      }
    } catch {
      // ignore
    }
  }

  onMount(() => {
    void syncState()
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

  const handleNext = () => {
    setErrorInfo(null)
    setStepResult(null)
    controller.setCurrentStep(currentStep())
    controller.next()
    setCurrentStep(controller.getCurrentStep())
    appendLog(`[step] 进入步骤: ${getStepMetadata(currentStep()).title}`)
  }

  const handlePrev = () => {
    setErrorInfo(null)
    setStepResult(null)
    controller.setCurrentStep(currentStep())
    controller.prev()
    setCurrentStep(controller.getCurrentStep())
    appendLog(`[step] 返回步骤: ${getStepMetadata(currentStep()).title}`)
  }

  const handleJumpStep = async (target: OnboardingStepName | "done") => {
    setErrorInfo(null)
    setStepResult(null)
    if (target !== "done") {
      const targetIdx = ONBOARDING_STEPS.indexOf(target as OnboardingStepName)
      for (let i = 0; i < targetIdx; i++) {
        const stepName = ONBOARDING_STEPS[i]
        const meta = getStepMetadata(stepName)
        if (!meta.optional) {
          try {
            const state = await window.api.onboardingGetState()
            const stepStatus = state?.steps?.[stepName]
            if (stepStatus !== "done" && stepStatus !== "skipped") {
              setErrorInfo({ message: `请先完成步骤"${meta.title}"。` })
              return
            }
          } catch {
            setErrorInfo({ message: "无法验证步骤状态，请重新开始。" })
            return
          }
        }
      }
    }
    setCurrentStep(target)
    controller.setCurrentStep(target)
    appendLog(`[step] 跳转到步骤: ${getStepMetadata(target).title}`)
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
    submitCurrentStep()
  }

  const submitCurrentStep = () => {
    const step = currentStep()
    if (step === "done") return
    const form = document.getElementById(`onboarding-step-${step}`)
    if (form instanceof HTMLFormElement) {
      form.requestSubmit()
      return
    }
    handleError("当前步骤无法执行，请刷新向导后重试。")
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

  const meta = () => getStepMetadata(currentStep())
  const content = () => getStepContent(currentStep())
  const stepIndex = () => (currentStep() === "done" ? ONBOARDING_STEPS.length : ONBOARDING_STEPS.indexOf(currentStep() as OnboardingStepName) + 1)

  const nextAction = () => {
    const mode = resolveForwardMode({
      done: currentStep() === "done",
      working: working(),
      success: stepResult()?.success,
      submitFromNavigation: !isExplicitActionStep(currentStep()),
    })
    if (mode === "advance") return { action: handleNext, disabled: false }
    if (mode === "submit") return { action: submitCurrentStep, disabled: false }
    return { action: () => {}, disabled: true }
  }

  const handleForward = () => {
    const next = nextAction()
    if (!next.disabled) next.action()
  }

  const statusMessage = () => {
    if (working()) return "正在执行当前步骤…"
    return "确认当前设置后，使用右侧箭头继续"
  }

  const feedbackMode = () => resolveFeedbackMode({
    hasError: errorInfo() !== null,
    working: working(),
    success: stepResult()?.success,
    showIdle: !isExplicitActionStep(currentStep()),
  })

  return (
    <div class="onboarding-container">
      <div class="ob-window-chrome" />

      <header class="ob-header">
        <div class="ob-brand">
          <img src="/ellamaka-text-logo.png?v=2" class="ob-brand-logo" alt="Ellamaka Logo" onError={(e) => (e.currentTarget.style.display = "none")} />
          <span style={{ "font-weight": "700", "font-size": "15px", color: "#fff" }}>WopalSpace 设置</span>
        </div>

        <div class="ob-tracker">
          <For each={ONBOARDING_STEPS}>
            {(stepName, idx) => (
              <button
                class={`ob-step-nav-pill ${currentStep() === stepName ? "active" : ""}`}
                onClick={() => handleJumpStep(stepName)}
                title={`第 ${idx() + 1} 步: ${getStepMetadata(stepName).title}`}
              >
                {idx() + 1}
              </button>
            )}
          </For>
        </div>
      </header>

      <main class="ob-main-wrapper">
        <div class="ob-main-content">
          <div class="ob-wizard-stage">
            <button
              type="button"
              class="ob-nav-arrow ob-nav-arrow-prev"
              aria-label="上一步"
              title="上一步"
              onClick={handlePrev}
              disabled={stepIndex() <= 1 || working()}
            >
              ‹
            </button>

            <div class="ob-grid-layout">
            {/* Left: Step Info */}
            <div class="ob-step-info">
              <div class="ob-step-info-card">
                <div class="ob-step-number">第 {stepIndex()} / {ONBOARDING_STEPS.length} 步</div>
                <h3 class="ob-step-info-title">{content()?.title ?? meta().title}</h3>
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

                <Show when={content()?.outcome}>
                  <div class="ob-step-info-section">
                    <div class="ob-step-info-label">完成后得到</div>
                    <p class="ob-step-info-text">{content()?.outcome}</p>
                  </div>
                </Show>

                <Show when={content()?.notes}>
                  <div class="ob-step-info-notes">
                    <div class="ob-step-info-label">注意事项</div>
                    <p class="ob-step-info-text">{content()?.notes}</p>
                  </div>
                </Show>
              </div>
            </div>

            {/* Right: Task Card */}
            <div class="ob-card">
              <div class="ob-card-header">
                <h2 class="ob-card-title">{meta().title}</h2>
                <Show when={meta().optional}>
                  <span class="ob-optional-tag">可选</span>
                </Show>
              </div>
              <p class="ob-mobile-step-summary">{content()?.goal ?? meta().description}</p>

              <Show when={feedbackMode() !== "hidden"}>
                <div class="ob-feedback-slot">
                  <Show
                    when={feedbackMode() === "error"}
                    fallback={
                      <div class="ob-status-banner" data-state={feedbackMode()}>
                        <span class="ob-status-dot" />
                        <span>{statusMessage()}</span>
                      </div>
                    }
                  >
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
                  </Show>
                </div>
              </Show>

              {/* Scrollable Content Area */}
              <div class="ob-card-body">
                <Switch>
                  <Match when={currentStep() === "system-check"}>
                    <SystemCheckStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                  </Match>
                  <Match when={currentStep() === "install-wopal-cli"}>
                    <InstallWopalCliStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                  </Match>
                  <Match when={currentStep() === "install-ellamaka-cli"}>
                    <InstallEllamakaCliStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                  </Match>
                  <Match when={currentStep() === "github-auth"}>
                    <GithubAuthStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                  </Match>
                  <Match when={currentStep() === "ai-provider"}>
                    <AiProviderStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                  </Match>
                  <Match when={currentStep() === "ontology-setup"}>
                    <OntologySetupStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                  </Match>
                  <Match when={currentStep() === "runtime-setup"}>
                    <RuntimeSetupStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                  </Match>
                  <Match when={currentStep() === "create-space"}>
                    <CreateSpaceStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                  </Match>
                  <Match when={currentStep() === "memory-config"}>
                    <MemoryConfigStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                  </Match>
                  <Match when={currentStep() === "star-guide"}>
                    <StarGuideStep onComplete={handleNext} onError={handleError} onStatusChange={handleStepStatusChange} />
                  </Match>
                  <Match when={currentStep() === "done"}>
                    <DoneStep />
                  </Match>
                </Switch>
              </div>

              <Show when={currentStep() !== "done" && (meta().optional || stepResult()?.success === false)}>
                <div class="ob-card-support-actions">
                  <Show when={meta().optional && !working() && !stepResult()?.success}>
                    <button type="button" class="ob-button ob-button-secondary" onClick={handleSkip}>
                      {currentStep() === "github-auth"
                        ? "暂不启用 GitHub"
                        : currentStep() === "ai-provider"
                          ? "使用默认免费模型"
                          : currentStep() === "memory-config"
                            ? zhCN.actions.disableMemory
                          : "跳过此步骤"}
                    </button>
                  </Show>
                  <Show when={stepResult()?.success === false && !isExplicitActionStep(currentStep())}>
                    <button type="button" class="ob-button ob-retry-button" onClick={handleRetry}>
                      重试
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
            </div>

            <button
              type="button"
              class="ob-nav-arrow ob-nav-arrow-next"
              aria-label="下一步"
              title={stepResult()?.success === false ? "请先重试当前步骤" : "下一步"}
              onClick={handleForward}
              disabled={nextAction().disabled}
            >
              ›
            </button>
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
