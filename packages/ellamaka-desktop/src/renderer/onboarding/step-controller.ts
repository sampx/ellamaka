import { ONBOARDING_STEPS, type OnboardingStepName } from "../../shared/onboarding-constants"
import { zhCN, type StepContent } from "./content/zh-CN"

export { ONBOARDING_STEPS, type OnboardingStepName }

export const OPTIONAL_STEPS: Set<OnboardingStepName> = new Set([
  "github-auth",
  "ai-provider",
  "memory-config",
  "star-guide",
])

export interface StepContext {
  hasExistingSpaces?: boolean
}

export function isOptionalStep(step: OnboardingStepName, context?: StepContext): boolean {
  if (step === "create-space") {
    return Boolean(context?.hasExistingSpaces)
  }
  return OPTIONAL_STEPS.has(step)
}

export interface PhaseConfig {
  phase: 1 | 2 | 3 | 4
  title: string
  steps: (OnboardingStepName | "done")[]
  autoAdvanceSteps: Set<OnboardingStepName>
}

export const PHASE_CONFIGS: PhaseConfig[] = [
  {
    phase: 1,
    title: "引擎准备",
    steps: ["system-check", "install-wopal-cli", "install-ellamaka-cli"],
    autoAdvanceSteps: new Set(["system-check", "install-wopal-cli", "install-ellamaka-cli"]),
  },
  {
    phase: 2,
    title: "能力与模型",
    steps: ["ontology-setup", "ai-provider"], // github-auth is integrated into ontology-setup
    autoAdvanceSteps: new Set([]),
  },
  {
    phase: 3,
    title: "空间与记忆",
    steps: ["runtime-setup", "create-space", "memory-config"],
    autoAdvanceSteps: new Set(["runtime-setup"]),
  },
  {
    phase: 4,
    title: "启动",
    steps: ["done"], // star-guide is silent on done page entry
    autoAdvanceSteps: new Set([]),
  },
]

export function getPhaseForStep(step: OnboardingStepName | "done"): PhaseConfig {
  if (step === "github-auth") {
    return PHASE_CONFIGS[1] // Phase 2 (integrated with ontology-setup)
  }
  if (step === "star-guide") {
    return PHASE_CONFIGS[3] // Phase 4 (integrated with done)
  }
  for (const config of PHASE_CONFIGS) {
    if (config.steps.includes(step)) {
      return config
    }
  }
  return PHASE_CONFIGS[0]
}

export interface StepMetadata {
  title: string
  description: string
  optional: boolean
  content?: StepContent
}

export const STEP_METADATA: Record<OnboardingStepName | "done", StepMetadata> = {
  "system-check": {
    title: zhCN.steps["system-check"].title,
    description: zhCN.steps["system-check"].goal,
    optional: false,
    content: zhCN.steps["system-check"],
  },
  "install-wopal-cli": {
    title: zhCN.steps["install-wopal-cli"].title,
    description: zhCN.steps["install-wopal-cli"].goal,
    optional: false,
    content: zhCN.steps["install-wopal-cli"],
  },
  "install-ellamaka-cli": {
    title: zhCN.steps["install-ellamaka-cli"].title,
    description: zhCN.steps["install-ellamaka-cli"].goal,
    optional: false,
    content: zhCN.steps["install-ellamaka-cli"],
  },
  "github-auth": {
    title: zhCN.steps["github-auth"].title,
    description: zhCN.steps["github-auth"].goal,
    optional: true,
    content: zhCN.steps["github-auth"],
  },
  "ai-provider": {
    title: zhCN.steps["ai-provider"].title,
    description: zhCN.steps["ai-provider"].goal,
    optional: true,
    content: zhCN.steps["ai-provider"],
  },
  "ontology-setup": {
    title: zhCN.steps["ontology-setup"].title,
    description: zhCN.steps["ontology-setup"].goal,
    optional: false,
    content: zhCN.steps["ontology-setup"],
  },
  "runtime-setup": {
    title: zhCN.steps["runtime-setup"].title,
    description: zhCN.steps["runtime-setup"].goal,
    optional: false,
    content: zhCN.steps["runtime-setup"],
  },
  "create-space": {
    title: zhCN.steps["create-space"].title,
    description: zhCN.steps["create-space"].goal,
    optional: false,
    content: zhCN.steps["create-space"],
  },
  "memory-config": {
    title: zhCN.steps["memory-config"].title,
    description: zhCN.steps["memory-config"].goal,
    optional: true,
    content: zhCN.steps["memory-config"],
  },
  "star-guide": {
    title: zhCN.steps["star-guide"].title,
    description: zhCN.steps["star-guide"].goal,
    optional: true,
    content: zhCN.steps["star-guide"],
  },
  done: {
    title: zhCN.steps.done.title,
    description: zhCN.steps.done.goal,
    optional: false,
    content: zhCN.steps.done,
  },
}

export function getStepMetadata(step: OnboardingStepName | "done"): StepMetadata {
  return STEP_METADATA[step] ?? { title: step, description: "", optional: false }
}

export function getStepContent(step: OnboardingStepName | "done"): StepContent | undefined {
  return STEP_METADATA[step]?.content
}

export type ForwardMode = "submit" | "advance" | "disabled"
export type FeedbackMode = "idle" | "working" | "error" | "hidden"

const EXPLICIT_ACTION_STEPS = new Set<OnboardingStepName>([
  "github-auth",
  "ai-provider",
  "ontology-setup",
  "create-space",
  "memory-config",
])

export function isExplicitActionStep(step: OnboardingStepName | "done"): boolean {
  return step !== "done" && EXPLICIT_ACTION_STEPS.has(step)
}

export function resolveFeedbackMode(input: {
  hasError: boolean
  working: boolean
  success: boolean | undefined
  showIdle?: boolean
}): FeedbackMode {
  if (input.hasError) return "error"
  if (input.working) return "working"
  if (input.success !== undefined) return "hidden"
  if (input.showIdle === false) return "hidden"
  return "idle"
}

export function resolveForwardMode(input: {
  done: boolean
  working: boolean
  success: boolean | undefined
  submitFromNavigation?: boolean
}): ForwardMode {
  if (input.done || input.working || input.success === false) return "disabled"
  if (input.success) return "advance"
  return input.submitFromNavigation === false ? "disabled" : "submit"
}

export function createStepController(initialStep: OnboardingStepName | "done" = "system-check") {
  let currentStep: OnboardingStepName | "done" = initialStep

  return {
    getCurrentStep: () => currentStep,
    setCurrentStep: (step: OnboardingStepName | "done") => {
      currentStep = step
    },
    getProgressPercent: () => {
      if (currentStep === "done") return 100
      const phase = getPhaseForStep(currentStep)
      return Math.round((phase.phase / 4) * 100)
    },
    next: () => {
      if (currentStep === "done") return
      const idx = ONBOARDING_STEPS.indexOf(currentStep as OnboardingStepName)
      if (idx !== -1 && idx < ONBOARDING_STEPS.length - 1) {
        let nextStep = ONBOARDING_STEPS[idx + 1]
        // Skip github-auth as standalone step because it's merged into ontology-setup
        if (nextStep === "github-auth") {
          nextStep = "ontology-setup"
        }
        // Skip star-guide as standalone step because it's merged into done
        if (nextStep === "star-guide") {
          currentStep = "done"
          return
        }
        currentStep = nextStep
      } else {
        currentStep = "done"
      }
    },
    prev: () => {
      if (currentStep === "done") {
        currentStep = "memory-config" // Skip star-guide standalone page
        return
      }
      const idx = ONBOARDING_STEPS.indexOf(currentStep as OnboardingStepName)
      if (idx > 0) {
        let prevStep = ONBOARDING_STEPS[idx - 1]
        if (prevStep === "github-auth") {
          prevStep = "install-ellamaka-cli"
        }
        if (prevStep === "star-guide") {
          prevStep = "memory-config"
        }
        currentStep = prevStep
      }
    },
    skip: (context?: StepContext) => {
      if (currentStep !== "done" && isOptionalStep(currentStep as OnboardingStepName, context)) {
        const idx = ONBOARDING_STEPS.indexOf(currentStep as OnboardingStepName)
        if (idx !== -1 && idx < ONBOARDING_STEPS.length - 1) {
          let nextStep = ONBOARDING_STEPS[idx + 1]
          if (nextStep === "star-guide") {
            currentStep = "done"
            return
          }
          currentStep = nextStep
        } else {
          currentStep = "done"
        }
      }
    },
  }
}
