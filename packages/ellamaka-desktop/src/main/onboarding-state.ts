import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, chmodSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { ONBOARDING_STEPS, type OnboardingStepName } from "../shared/onboarding-constants"

export { ONBOARDING_STEPS, type OnboardingStepName }

export type OnboardingStepStatus = "pending" | "in-progress" | "done" | "skipped" | "failed"

export interface OnboardingState {
  version: 1
  currentStep: OnboardingStepName | "done"
  steps: Record<OnboardingStepName, OnboardingStepStatus>
  errors: Partial<Record<OnboardingStepName, string>>
  completed: boolean
  startedAt: string | null
  updatedAt: string | null
  warnings?: string[]
}

export function getWopalHome(customHome?: string): string {
  const raw = customHome ?? process.env.WOPAL_HOME ?? join(homedir(), ".wopal")
  // Resolve ~ to home directory — Node.js path APIs don't expand ~
  if (raw.startsWith("~")) {
    return join(homedir(), raw.slice(1))
  }
  return raw
}

export function getOnboardingStatePath(customHome?: string): string {
  const home = getWopalHome(customHome)
  return join(home, "ellamaka", "state", "onboarding.json")
}

export function createDefaultOnboardingState(): OnboardingState {
  const steps = ONBOARDING_STEPS.reduce(
    (acc, step) => {
      acc[step] = "pending"
      return acc
    },
    {} as Record<OnboardingStepName, OnboardingStepStatus>,
  )

  return {
    version: 1,
    currentStep: "system-check",
    steps,
    errors: {},
    completed: false,
    startedAt: null,
    updatedAt: null,
  }
}

function formatDateTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const yyyy = d.getFullYear()
  const mm = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const hh = pad(d.getHours())
  const min = pad(d.getMinutes())
  const ss = pad(d.getSeconds())
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`
}

export function readOnboardingState(customHome?: string): OnboardingState | null {
  const statePath = getOnboardingStatePath(customHome)
  if (!existsSync(statePath)) {
    return null
  }

  try {
    const raw = readFileSync(statePath, "utf-8")
    const parsed = JSON.parse(raw) as OnboardingState
    if (parsed && typeof parsed === "object" && parsed.version === 1 && typeof parsed.steps === "object") {
      return parsed
    }
    throw new Error("Invalid schema structure")
  } catch {
    // File exists but is invalid/corrupted -> move to backup
    try {
      const backupPath = `${statePath}.bak.${formatDateTimestamp()}`
      renameSync(statePath, backupPath)
    } catch {
      // Best effort cleanup if rename fails
      try {
        unlinkSync(statePath)
      } catch {
        // ignore
      }
    }
    return null
  }
}

export function writeOnboardingState(state: OnboardingState, customHome?: string): boolean {
  const statePath = getOnboardingStatePath(customHome)
  const dirPath = dirname(statePath)

  try {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
    }

    const tmpPath = `${statePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`
    const content = JSON.stringify(state, null, 2)

    writeFileSync(tmpPath, content, "utf-8")
    if (process.platform !== "win32") {
      chmodSync(tmpPath, 0o600)
    }
    renameSync(tmpPath, statePath)
    return true
  } catch (err) {
    console.error("[onboarding-state] Failed to write state:", err)
    return false
  }
}

export function updateStep(
  state: OnboardingState,
  step: OnboardingStepName,
  status: OnboardingStepStatus,
  error?: string,
): OnboardingState {
  const now = new Date().toISOString()
  const nextSteps = { ...state.steps, [step]: status }
  const nextErrors = { ...state.errors }

  if (error) {
    nextErrors[step] = error
  } else if (status !== "failed") {
    delete nextErrors[step]
  }

  return {
    ...state,
    currentStep: step,
    steps: nextSteps,
    errors: nextErrors,
    updatedAt: now,
  }
}

export function markStarted(state: OnboardingState): OnboardingState {
  if (state.startedAt) return state
  const now = new Date().toISOString()
  return {
    ...state,
    startedAt: now,
    updatedAt: now,
  }
}

export function markCompleted(state: OnboardingState): OnboardingState {
  const now = new Date().toISOString()
  return {
    ...state,
    completed: true,
    currentStep: "done",
    updatedAt: now,
  }
}

export function advanceToNextStep(
  state: OnboardingState,
  currentStep: OnboardingStepName,
): OnboardingState {
  const idx = ONBOARDING_STEPS.indexOf(currentStep)
  if (idx === -1 || idx >= ONBOARDING_STEPS.length - 1) {
    return { ...state, currentStep: "done", updatedAt: new Date().toISOString() }
  }
  return {
    ...state,
    currentStep: ONBOARDING_STEPS[idx + 1],
    updatedAt: new Date().toISOString(),
  }
}
