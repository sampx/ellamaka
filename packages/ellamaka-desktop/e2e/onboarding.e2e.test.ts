import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { createOnboardingTestEnv } from "./onboarding-harness"

describe("Onboarding E2E Flow", () => {
  let env: ReturnType<typeof createOnboardingTestEnv>

  beforeEach(() => {
    env = createOnboardingTestEnv()
  })

  afterEach(() => {
    env.cleanup()
  })

  test("initial launch enters onboarding mode", () => {
    const mode = env.getMode()
    expect(mode).toBe("onboarding")
  })

  test("completion switches launch mode to workbench", () => {
    expect(env.getMode()).toBe("onboarding")
    env.markOnboardingComplete()
    expect(env.getMode()).toBe("workbench")
  })
})
