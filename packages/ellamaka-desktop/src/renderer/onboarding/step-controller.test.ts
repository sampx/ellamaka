import { describe, expect, test } from "bun:test"
import {
  createStepController,
  getStepMetadata,
  isExplicitActionStep,
  isOptionalStep,
  ONBOARDING_STEPS,
  resolveFeedbackMode,
  resolveForwardMode,
} from "./step-controller"

describe("step-controller", () => {
  test("ONBOARDING_STEPS contains 10 steps in order", () => {
    expect(ONBOARDING_STEPS.length).toBe(10)
    expect(ONBOARDING_STEPS[0]).toBe("system-check")
    expect(ONBOARDING_STEPS[5]).toBe("ontology-setup")
    expect(ONBOARDING_STEPS[6]).toBe("runtime-setup")
    expect(ONBOARDING_STEPS[7]).toBe("create-space")
    expect(ONBOARDING_STEPS[9]).toBe("star-guide")
  })

  test("isOptionalStep correctly identifies optional steps", () => {
    expect(isOptionalStep("github-auth")).toBe(true)
    expect(isOptionalStep("ai-provider")).toBe(true)
    expect(isOptionalStep("memory-config")).toBe(true)
    expect(isOptionalStep("star-guide")).toBe(true)
    expect(isOptionalStep("system-check")).toBe(false)
    expect(isOptionalStep("install-wopal-cli")).toBe(false)
  })

  test("stepController handles next/prev/skip navigation", () => {
    const controller = createStepController("system-check")

    expect(controller.getCurrentStep()).toBe("system-check")
    expect(controller.getProgressPercent()).toBe(10)

    controller.next()
    expect(controller.getCurrentStep()).toBe("install-wopal-cli")

    controller.skip() // install-wopal-cli is not optional, stays at install-wopal-cli
    expect(controller.getCurrentStep()).toBe("install-wopal-cli")
  })

  test("getStepMetadata returns valid title and description for steps", () => {
    const meta = getStepMetadata("system-check")
    expect(meta.title).toBeDefined()
    expect(meta.description).toBeDefined()
  })

  test("resolveForwardMode never resubmits a successful step", () => {
    expect(resolveForwardMode({ done: false, working: false, success: undefined })).toBe("submit")
    expect(resolveForwardMode({ done: false, working: false, success: undefined, submitFromNavigation: false })).toBe("disabled")
    expect(resolveForwardMode({ done: false, working: false, success: true })).toBe("advance")
    expect(resolveForwardMode({ done: false, working: false, success: false })).toBe("disabled")
    expect(resolveForwardMode({ done: false, working: true, success: undefined })).toBe("disabled")
    expect(resolveForwardMode({ done: true, working: false, success: true })).toBe("disabled")
  })

  test("credential steps require an explicit action before navigation", () => {
    expect(isExplicitActionStep("github-auth")).toBe(true)
    expect(isExplicitActionStep("ai-provider")).toBe(true)
    expect(isExplicitActionStep("ontology-setup")).toBe(true)
    expect(isExplicitActionStep("create-space")).toBe(true)
    expect(isExplicitActionStep("memory-config")).toBe(true)
    expect(isExplicitActionStep("system-check")).toBe(false)
  })

  test("resolveFeedbackMode hides redundant completion feedback", () => {
    expect(resolveFeedbackMode({ hasError: false, working: false, success: undefined })).toBe("idle")
    expect(resolveFeedbackMode({ hasError: false, working: false, success: undefined, showIdle: false })).toBe("hidden")
    expect(resolveFeedbackMode({ hasError: false, working: true, success: undefined })).toBe("working")
    expect(resolveFeedbackMode({ hasError: true, working: false, success: false })).toBe("error")
    expect(resolveFeedbackMode({ hasError: false, working: false, success: true })).toBe("hidden")
  })
})
