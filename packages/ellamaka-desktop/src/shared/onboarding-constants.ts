export const ONBOARDING_STEPS = [
  "system-check",
  "install-wopal-cli",
  "install-ellamaka-cli",
  "github-auth",
  "ontology-setup",
  "ai-provider",
  "runtime-setup",
  "create-space",
  "memory-config",
  "star-guide",
] as const

export type OnboardingStepName = (typeof ONBOARDING_STEPS)[number]
