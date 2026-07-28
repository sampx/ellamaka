import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { buildMemoryOperationInput, createOnboardingIpcHandlers } from "./onboarding-ipc"
import { readOnboardingState } from "./onboarding-state"

describe("onboarding-ipc", () => {
  let testHome: string

  beforeEach(() => {
    testHome = join(tmpdir(), `onboarding-ipc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testHome, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true })
    }
  })

  test("getOnboardingMode returns 'onboarding' by default", async () => {
    const handlers = createOnboardingIpcHandlers({ homePath: testHome })
    const result = await handlers["get-onboarding-mode"]()
    expect(result).toEqual({ mode: "onboarding" })
  })

  test("onboardingGetState returns null initially", async () => {
    const handlers = createOnboardingIpcHandlers({ homePath: testHome })
    const state = await handlers["onboarding-get-state"]()
    expect(state).toBeNull()
  })

  test("onboardingExecuteStep validates step name", async () => {
    const handlers = createOnboardingIpcHandlers({ homePath: testHome })
    const result = await handlers["onboarding-execute-step"]({}, "invalid-step" as any)
    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("ONBOARDING_STEP_INVALID")
  })

  test("onboardingExecuteStep executes handler and updates state", async () => {
    const executor = async (step: string, input: any) => {
      return { status: "completed" as const, result: { ok: true } }
    }

    const handlers = createOnboardingIpcHandlers({
      homePath: testHome,
      executeStep: executor,
    })

    const result = await handlers["onboarding-execute-step"]({}, "system-check")
    expect(result.status).toBe("completed")

    const state = readOnboardingState(testHome)
    expect(state).not.toBeNull()
    expect(state?.steps["system-check"]).toBe("done")
  })

  test("onboardingExecuteStep serializes concurrent calls sequentially", async () => {
    let resolveSlow: (val: any) => void = () => {}
    const slowExecutor = (step: string) =>
      new Promise<any>((resolve) => {
        if (step === "system-check") {
          resolveSlow = resolve
        } else {
          resolve({ status: "completed", result: { step } })
        }
      })

    const handlers = createOnboardingIpcHandlers({
      homePath: testHome,
      executeStep: slowExecutor,
    })

    const p1 = handlers["onboarding-execute-step"]({}, "system-check")
    const p2 = handlers["onboarding-execute-step"]({}, "install-wopal-cli")

    // Unblock p1
    resolveSlow({ status: "completed", result: { step: "system-check" } })

    const res1 = await p1
    const res2 = await p2

    expect(res1.status).toBe("completed")
    expect(res2.status).toBe("completed")
  })

  test("onboardingComplete marks state as completed only when inspect is healthy", async () => {
    const executor = async (step: string) => ({
      status: "reused" as const,
      result: step === "inspect" ? { verdict: "healthy", verdictReason: "All components are ready." } : {},
    })
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })
    const result = await handlers["onboarding-complete"]()

    expect(result.status).toBe("completed")
    const state = readOnboardingState(testHome)
    expect(state?.completed).toBe(true)
    expect(state?.currentStep).toBe("done")
  })

  for (const verdict of ["fresh", "partial", "broken"] as const) {
    test(`onboardingComplete rejects ${verdict} runtime and preserves onboarding mode`, async () => {
      const executor = async () => ({
        status: "reused" as const,
        result: { verdict, verdictReason: `Runtime is ${verdict}.` },
      })
      const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })
      const result = await handlers["onboarding-complete"]()

      expect(result.status).toBe("failed")
      expect(result.error?.code).toBe("ONBOARDING_NOT_READY")
      expect(readOnboardingState(testHome)?.completed ?? false).toBe(false)
    })
  }

  test("onboardingComplete rejects inspect failure", async () => {
    const executor = async () => ({
      status: "failed" as const,
      error: { code: "SETUP_OPERATION_FAILED", message: "inspect failed" },
    })
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })
    const result = await handlers["onboarding-complete"]()

    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("ONBOARDING_READINESS_CHECK_FAILED")
    expect(readOnboardingState(testHome)?.completed ?? false).toBe(false)
  })

  test("onboardingProbe does not create onboarding.json or advance state", async () => {
    const handlers = createOnboardingIpcHandlers({ homePath: testHome })
    await handlers["onboarding-probe"]({}, "github-auth")

    const state = readOnboardingState(testHome)
    expect(state).toBeNull()
  })

  test("onboardingProbe github-auth returns detected info", async () => {
    const handlers = createOnboardingIpcHandlers({ homePath: testHome })
    const result = await handlers["onboarding-probe"]({}, "github-auth")
    expect(result).toHaveProperty("detected")
    expect(result).toHaveProperty("source")
  })

  test("onboardingProbe ai-provider returns hasKey", async () => {
    const handlers = createOnboardingIpcHandlers({ homePath: testHome })
    const result = await handlers["onboarding-probe"]({}, "ai-provider")
    expect(result).toHaveProperty("hasKey")
  })

  test("onboardingProbe environment returns flat structure", async () => {
    const handlers = createOnboardingIpcHandlers({ homePath: testHome })
    const result = await handlers["onboarding-probe"]({}, "environment")
    expect(result).toHaveProperty("availableTypes")
    expect(result).toHaveProperty("spaces")
    expect(result).toHaveProperty("ontologyInstalled")
    expect(result).toHaveProperty("ontologyMode")
    expect(result).toHaveProperty("defaultSpacePath")
  })

  test("onboardingProbe environment provides common type for an older CLI contract", async () => {
    const executor = async (step: string) => {
      expect(step).toBe("inspect")
      return { status: "reused" as const, result: { spaceCount: 0 } }
    }
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })

    const result = await handlers["onboarding-probe"]({}, "environment")

    expect(result.availableTypes).toEqual([{ type: "common", branch: "main" }])
    expect(result.legacyContract).toBe(true)
    expect(result).not.toHaveProperty("error")
  })

  test("onboardingProbe environment returns the inspect failure", async () => {
    const executor = async () => ({
      status: "failed" as const,
      error: { code: "SETUP_RESPONSE_INVALID", message: "machine output missing" },
    })
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })

    const result = await handlers["onboarding-probe"]({}, "environment")

    expect(result.error).toBe("machine output missing")
    expect(result.errorCode).toBe("SETUP_RESPONSE_INVALID")
  })

  test("onboardingProbe runtime returns the read-only runtime inspection", async () => {
    const runtime = {
      ready: true,
      homePath: testHome,
      settingsPath: `${testHome}/config/settings.jsonc`,
      config: { status: "ok", presentKeys: ["permission"], missingKeys: [] },
      scripts: { status: "ok", present: ["wopal"], missing: [], stale: [] },
      capabilities: { status: "ok", present: ["agents"], missing: [], empty: [], stale: [] },
    }
    const executor = async (step: string) => {
      expect(step).toBe("inspect")
      return { status: "reused" as const, result: { runtime } }
    }
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })

    const result = await handlers["onboarding-probe"]({}, "runtime")

    expect(result).toEqual(runtime)
    expect(readOnboardingState(testHome)).toBeNull()
  })

  test("onboardingProbe memory returns the safe inspect summary", async () => {
    const memory = {
      state: "ready",
      enabled: true,
      envPath: `${testHome}/.env`,
      llm: { endpoint: "https://api.example.com", model: "gpt-4o", keyConfigured: true },
      embedding: { endpoint: "https://api.example.com", model: "embed", keyConfigured: false },
    }
    const handlers = createOnboardingIpcHandlers({
      homePath: testHome,
      executeStep: async () => ({ status: "reused", result: { memory } }),
    })

    const result = await handlers["onboarding-probe"]({}, "memory")

    expect(result).toEqual(memory)
    expect(JSON.stringify(result)).not.toContain("apiKey")
  })

  test("buildMemoryOperationInput maps skip to a real disable", () => {
    expect(buildMemoryOperationInput({ skip: true, advanced: { backend: "sqlite" } })).toEqual({ enabled: false })
  })

  test("buildMemoryOperationInput forwards only supported fields", () => {
    expect(buildMemoryOperationInput({
      enabled: true,
      llmEndpoint: "https://api.example.com",
      llmKey: "secret",
      embeddingModel: "embed",
      advanced: { backend: "sqlite" },
    })).toEqual({
      enabled: true,
      llmEndpoint: "https://api.example.com",
      llmKey: "secret",
      embeddingModel: "embed",
    })
  })

  test("onboardingExecuteStep ontology-setup success advances currentStep", async () => {
    const executor = async () => ({ status: "completed" as const, result: {} })
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })
    const result = await handlers["onboarding-execute-step"]({}, "ontology-setup", { mode: "clone" })
    expect(result.status).toBe("completed")

    const state = readOnboardingState(testHome)
    expect(state?.steps["ontology-setup"]).toBe("done")
    expect(state?.currentStep).toBe("ai-provider")
  })

  test("onboardingExecuteStep ontology-setup failed stays on ontology-setup", async () => {
    const executor = async () => ({ status: "failed" as const, error: { code: "ERR", message: "fail" } })
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })
    const result = await handlers["onboarding-execute-step"]({}, "ontology-setup", { mode: "clone" })
    expect(result.status).toBe("failed")

    const state = readOnboardingState(testHome)
    expect(state?.steps["ontology-setup"]).toBe("failed")
    expect(state?.currentStep).toBe("ontology-setup")
  })

  test("onboardingExecuteStep runtime-setup success advances to create-space", async () => {
    const executor = async () => ({ status: "completed" as const, result: {} })
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })
    const result = await handlers["onboarding-execute-step"]({}, "runtime-setup")
    expect(result.status).toBe("completed")

    const state = readOnboardingState(testHome)
    expect(state?.steps["runtime-setup"]).toBe("done")
    expect(state?.currentStep).toBe("create-space")
  })

  test("onboardingExecuteStep runtime-setup failed stays on runtime-setup", async () => {
    const executor = async () => ({
      status: "failed" as const,
      error: { code: "SETUP_RUNTIME_PREPARE_FAILED", message: "runtime incomplete" },
    })
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })
    const result = await handlers["onboarding-execute-step"]({}, "runtime-setup")
    expect(result.status).toBe("failed")

    const state = readOnboardingState(testHome)
    expect(state?.steps["runtime-setup"]).toBe("failed")
    expect(state?.currentStep).toBe("runtime-setup")
  })

  test("onboardingExecuteStep create-space success advances currentStep", async () => {
    const executor = async () => ({ status: "completed" as const, result: {} })
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })
    const result = await handlers["onboarding-execute-step"]({}, "create-space", { path: "/tmp/ws" })
    expect(result.status).toBe("completed")

    const state = readOnboardingState(testHome)
    expect(state?.steps["create-space"]).toBe("done")
    expect(state?.currentStep).toBe("memory-config")
  })

  test("onboardingExecuteStep create-space failed stays on create-space", async () => {
    const executor = async () => ({ status: "failed" as const, error: { code: "ERR", message: "fail" } })
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })
    const result = await handlers["onboarding-execute-step"]({}, "create-space", { path: "/tmp/ws" })
    expect(result.status).toBe("failed")

    const state = readOnboardingState(testHome)
    expect(state?.steps["create-space"]).toBe("failed")
    expect(state?.currentStep).toBe("create-space")
  })

  test("onboardingExecuteStep broadcasts useful lifecycle logs", async () => {
    const events: Array<{ step?: string; phase?: string; message?: string; suggestion?: string; details?: string }> = []
    const executor = async () => ({
      status: "failed" as const,
      error: {
        code: "SETUP_SPACE_FAILED",
        message: "space branch already conflicts",
        suggestion: "Choose another directory.",
        details: "Operation: initialize-space\nExit code: 1",
      },
    })
    const handlers = createOnboardingIpcHandlers({
      homePath: testHome,
      executeStep: executor,
      broadcastProgress: (event) => events.push(event),
    })

    await handlers["onboarding-execute-step"]({}, "create-space", { path: "/tmp/ws", type: "common" })

    expect(events).toEqual([
      {
        step: "create-space",
        phase: "starting",
        message: "开始创建或复用工作空间…",
      },
      {
        step: "create-space",
        phase: "failed",
        message: "创建或复用工作空间失败 [SETUP_SPACE_FAILED]: space branch already conflicts",
        suggestion: "Choose another directory.",
        details: "Operation: initialize-space\nExit code: 1",
      },
    ])
    const persistedLog = readFileSync(join(testHome, "logs", "onboarding.log"), "utf8")
    expect(persistedLog).toContain("Suggestion: Choose another directory.")
    expect(persistedLog).toContain("Operation: initialize-space")
    expect(persistedLog).toContain("Exit code: 1")
  })

  test("onboardingExecuteStep create-space skip on fresh env returns failed", async () => {
    const executor = async (step: string, input: any) => {
      if ((input as any)?.skip) return { status: "failed" as const, error: { code: "NO_EXISTING_SPACE", message: "cannot skip" } }
      return { status: "completed" as const, result: {} }
    }
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })
    const result = await handlers["onboarding-execute-step"]({}, "create-space", { skip: true })
    expect(result.status).toBe("failed")

    const state = readOnboardingState(testHome)
    expect(state?.currentStep).toBe("create-space")
  })

  test("onboardingExecuteStep step failed does not advance currentStep", async () => {
    const executor = async () => {
      throw new Error("step error")
    }
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })
    const result = await handlers["onboarding-execute-step"]({}, "system-check")
    expect(result.status).toBe("failed")

    const state = readOnboardingState(testHome)
    expect(state?.steps["system-check"]).toBe("failed")
    expect(state?.currentStep).toBe("system-check")
  })
})
