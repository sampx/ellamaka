export const ONBOARDING_STEPS = [
  "system-check",
  "install-cli",
  "github-auth",
  "ontology-setup",
  "create-space",
  "ai-provider",
  "memory-config",
  "done",
] as const

export type OnboardingStepName = (typeof ONBOARDING_STEPS)[number]
