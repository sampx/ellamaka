import { ONBOARDING_STEPS, type OnboardingStepName } from "../../shared/onboarding-constants"
import { zhCN, type StepContent } from "./content/zh-CN"

export { ONBOARDING_STEPS, type OnboardingStepName }

export const OPTIONAL_STEPS: Set<OnboardingStepName> = new Set([
  "github-auth",
  "ai-provider",
  "memory-config",
  "star-guide",
])

export function isOptionalStep(step: OnboardingStepName): boolean {
  return OPTIONAL_STEPS.has(step)
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
      const idx = ONBOARDING_STEPS.indexOf(currentStep as OnboardingStepName)
      if (idx === -1) return 0
      return Math.round(((idx + 1) / ONBOARDING_STEPS.length) * 100)
    },
    next: () => {
      if (currentStep === "done") return
      const idx = ONBOARDING_STEPS.indexOf(currentStep as OnboardingStepName)
      if (idx !== -1 && idx < ONBOARDING_STEPS.length - 1) {
        currentStep = ONBOARDING_STEPS[idx + 1]
      } else {
        currentStep = "done"
      }
    },
    prev: () => {
      if (currentStep === "done") {
        currentStep = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]
        return
      }
      const idx = ONBOARDING_STEPS.indexOf(currentStep as OnboardingStepName)
      if (idx > 0) {
        currentStep = ONBOARDING_STEPS[idx - 1]
      }
    },
    skip: () => {
      if (currentStep !== "done" && isOptionalStep(currentStep as OnboardingStepName)) {
        const idx = ONBOARDING_STEPS.indexOf(currentStep as OnboardingStepName)
        if (idx !== -1 && idx < ONBOARDING_STEPS.length - 1) {
          currentStep = ONBOARDING_STEPS[idx + 1]
        } else {
          currentStep = "done"
        }
      }
    },
  }
}
