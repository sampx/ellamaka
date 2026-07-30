import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  buildMemoryOperationInput,
  createOnboardingIpcHandlers,
  detectMemoryConfig,
  detectGithubToken,
  probeGithubAuthentication,
  probeLocalCli,
} from "./onboarding-ipc"
import { readOnboardingState } from "./onboarding-state"
import { getOnboardingLogger } from "./onboarding-logger"

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

  test("onboardingExecuteStep rejects concurrent calls while an operation is active", async () => {
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
    const p2 = handlers["onboarding-execute-step"]({}, "install-cli")

    // Unblock p1
    resolveSlow({ status: "completed", result: { step: "system-check" } })

    const res1 = await p1
    const res2 = await p2

    expect(res1.status).toBe("completed")
    expect(res2.status).toBe("failed")
    expect(res2.error?.code).toBe("ONBOARDING_OPERATION_BUSY")
  })

  test("onboardingExecuteStep rejects a duplicate operation instead of queueing it", async () => {
    let resolveSlow: (value: any) => void = () => {}
    let callCount = 0
    const executor = () => {
      callCount += 1
      if (callCount > 1) return Promise.resolve({ status: "completed", result: {} })
      return new Promise<any>((resolve) => {
        resolveSlow = resolve
      })
    }
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })

    const active = handlers["onboarding-execute-step"]({}, "install-cli", { subStep: "wopal" })
    const duplicate = handlers["onboarding-execute-step"]({}, "install-cli", { subStep: "wopal" })
    await Promise.resolve()
    resolveSlow({ status: "completed", result: {} })

    const duplicateResult = await duplicate
    await active

    expect(duplicateResult.status).toBe("failed")
    expect(duplicateResult.error?.code).toBe("ONBOARDING_OPERATION_BUSY")
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

  test("onboarding-set-current-step persists currentStep to disk", async () => {
    const handlers = createOnboardingIpcHandlers({ homePath: testHome })
    const res = await handlers["onboarding-set-current-step"](null as any, "memory-config")

    expect(res.status).toBe("ok")
    const state = readOnboardingState(testHome)
    expect(state?.currentStep).toBe("memory-config")
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

  test("onboardingProbe home returns homePath instantly", async () => {
    const handlers = createOnboardingIpcHandlers({ homePath: testHome })
    const result = await handlers["onboarding-probe"]({}, "home")
    expect(result).toEqual({ homePath: testHome, wopalHome: testHome })
  })

  test("onboardingProbe ontology-setup returns a ready inspected fork", async () => {
    const handlers = createOnboardingIpcHandlers({
      homePath: testHome,
      executeStep: async () => ({
        status: "reused",
        result: {
          ontologyInstalled: true,
          ontologyMode: "fork",
          availableTypes: [{ type: "common", branch: "main" }],
        },
      }),
    })
    const result = await handlers["onboarding-probe"]({}, "ontology-setup")
    expect(result).toMatchObject({
      status: "ready",
      ontologyInstalled: true,
      ontologyMode: "fork",
      ontologyPath: join(testHome, "ontologies", "wopal-space-ontology"),
    })
  })

  test("onboardingProbe ontology-setup reports an existing non-repository directory as broken", async () => {
    mkdirSync(join(testHome, "ontologies", "wopal-space-ontology"), { recursive: true })
    const handlers = createOnboardingIpcHandlers({
      homePath: testHome,
      executeStep: async () => ({
        status: "reused",
        result: { ontologyInstalled: false, ontologyMode: null, availableTypes: [] },
      }),
    })

    const result = await handlers["onboarding-probe"]({}, "ontology-setup")

    expect(result).toMatchObject({
      status: "broken",
      ontologyInstalled: false,
      ontologyMode: null,
    })
  })

  test("onboardingProbe ontology-setup reports a fresh environment as missing", async () => {
    const handlers = createOnboardingIpcHandlers({
      homePath: testHome,
      executeStep: async () => ({
        status: "reused",
        result: { ontologyInstalled: false, ontologyMode: null, availableTypes: [] },
      }),
    })

    const result = await handlers["onboarding-probe"]({}, "ontology-setup")

    expect(result).toMatchObject({
      status: "missing",
      ontologyInstalled: false,
      ontologyMode: null,
    })
  })

  test("onboardingProbe ontology-setup rejects an installed ontology with unknown topology", async () => {
    mkdirSync(join(testHome, "ontologies", "wopal-space-ontology"), { recursive: true })
    const handlers = createOnboardingIpcHandlers({
      homePath: testHome,
      executeStep: async () => ({
        status: "reused",
        result: { ontologyInstalled: true, ontologyMode: null, availableTypes: [] },
      }),
    })

    const result = await handlers["onboarding-probe"]({}, "ontology-setup")

    expect(result).toMatchObject({
      status: "broken",
      ontologyInstalled: false,
      ontologyMode: null,
    })
  })

  test("onboardingProbe github-auth returns detected info", async () => {
    const handlers = createOnboardingIpcHandlers({ homePath: testHome })
    const result = await handlers["onboarding-probe"]({}, "github-auth")
    expect(result).toHaveProperty("detected")
    expect(result).toHaveProperty("source")
  })

  test("detectGithubToken identifies GH_TOKEN without invoking other sources", () => {
    const result = detectGithubToken(testHome, {
      env: { GH_TOKEN: "gh_test" },
      loadUserShellEnv: () => ({}),
      readGhToken: () => null,
    })

    expect(result).toEqual({ token: "gh_test", source: "gh-token-env" })
  })

  test("detectGithubToken identifies authenticated GitHub CLI", () => {
    const result = detectGithubToken(testHome, {
      env: {},
      loadUserShellEnv: () => ({}),
      readGhToken: () => "gho_cli_token",
    })

    expect(result).toEqual({ token: "gho_cli_token", source: "gh-cli" })
  })

  test("probeGithubAuthentication reports CLI account and token source without exposing secrets", () => {
    const result = probeGithubAuthentication(testHome, {
      env: { GH_TOKEN: "configured_token" },
      loadUserShellEnv: () => ({}),
      probeGhCli: () => ({ installed: true, authenticated: true, account: "sam" }),
    })

    expect(result).toEqual({
      detected: true,
      source: "gh-cli",
      account: "sam",
      ghCliInstalled: true,
      ghCliAuthenticated: true,
      tokenConfigured: true,
      tokenSource: "gh-token-env",
    })
    expect(JSON.stringify(result)).not.toContain("configured_token")
  })

  test("probeGithubAuthentication reports an installed but unauthenticated CLI", () => {
    const result = probeGithubAuthentication(testHome, {
      env: {},
      loadUserShellEnv: () => ({}),
      probeGhCli: () => ({ installed: true, authenticated: false, account: null }),
    })

    expect(result).toEqual({
      detected: false,
      source: null,
      account: null,
      ghCliInstalled: true,
      ghCliAuthenticated: false,
      tokenConfigured: false,
      tokenSource: null,
    })
  })

  test("onboardingProbe ai-provider returns hasKey", async () => {
    const handlers = createOnboardingIpcHandlers({ homePath: testHome })
    const result = await handlers["onboarding-probe"]({}, "ai-provider")
    expect(result).toHaveProperty("hasKey")
  })

  test("probeLocalCli reports a missing binary without executing it", () => {
    let executed = false

    const result = probeLocalCli("/missing/wopal", {
      exists: () => false,
      readVersion: () => {
        executed = true
        return { status: 0, stdout: "wopal 1.0.0" }
      },
    })

    expect(result).toEqual({ installed: false, binaryPath: "/missing/wopal" })
    expect(executed).toBe(false)
  })

  test("probeLocalCli returns the local version without remote checks", () => {
    const result = probeLocalCli("/opt/wopal/bin/wopal", {
      exists: () => true,
      readVersion: () => ({ status: 0, stdout: "wopal 1.2.3\n" }),
    })

    expect(result).toEqual({
      installed: true,
      version: "wopal 1.2.3",
      binaryPath: "/opt/wopal/bin/wopal",
    })
  })

  test("probeLocalCli reports an unusable local binary", () => {
    const result = probeLocalCli("/opt/wopal/bin/wopal", {
      exists: () => true,
      readVersion: () => ({ status: 1, stdout: "" }),
    })

    expect(result.installed).toBe(false)
    expect(result.errorCode).toBe("CLI_BINARY_BROKEN")
  })

  test("onboardingProbe exposes read-only local CLI states", async () => {
    const handlers = createOnboardingIpcHandlers({ homePath: testHome })

    const wopal = await handlers["onboarding-probe"]({}, "wopal-cli")
    const ellamaka = await handlers["onboarding-probe"]({}, "ellamaka-cli")

    expect(wopal).toMatchObject({ installed: false, binaryPath: join(testHome, "bin", process.platform === "win32" ? "wopal.exe" : "wopal") })
    expect(ellamaka).toMatchObject({ installed: false, binaryPath: join(testHome, "bin", process.platform === "win32" ? "ellamaka.exe" : "ellamaka") })
    expect(readOnboardingState(testHome)).toBeNull()
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

  test("onboardingProbe memory attaches the inspected space when the memory summary lacks one", async () => {
    const space = { name: "space1", path: join(testHome, "space1"), type: "common" }
    const memory = {
      state: "unconfigured",
      enabled: false,
      envPath: `${testHome}/.env`,
    }
    const handlers = createOnboardingIpcHandlers({
      homePath: testHome,
      executeStep: async () => ({ status: "reused", result: { memory, spaces: [space] } }),
    })

    const result = await handlers["onboarding-probe"]({}, "memory")

    expect(result).toEqual({ ...memory, effectiveSpace: space })
  })

  test("detectMemoryConfig preserves the effective space when memory is not configured", () => {
    const spacePath = join(testHome, "space1")

    const result = detectMemoryConfig(testHome, {
      listSpaces: () => [{ name: "space1", path: spacePath, type: "common" }],
    })

    expect(result).toMatchObject({
      state: "unconfigured",
      enabled: false,
      globalMemory: null,
      spaceMemory: null,
      effectiveSpace: { name: "space1", path: spacePath, type: "common" },
    })
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

  test("space memory inherit when global is disabled clears space file and does not modify global file", async () => {
    const spaceDir = join(testHome, "space1")
    const spaceWopalDir = join(spaceDir, ".wopal")
    mkdirSync(spaceWopalDir, { recursive: true })

    // Setup global env with WOPAL_MEMORY_ENABLED=false
    const globalEnvPath = join(testHome, ".env")
    writeFileSync(globalEnvPath, "WOPAL_MEMORY_ENABLED=false\n", "utf-8")

    // Simulate the legacy CLI behavior: configure-memory always writes global state.
    // Space-scoped changes must never invoke this global-only operation.
    const fakeCliPath = join(testHome, "fake-wopal.ts")
    writeFileSync(fakeCliPath, `
import { writeFileSync } from "node:fs"
import { join } from "node:path"
await Bun.stdin.text()
writeFileSync(join(process.env.WOPAL_HOME ?? "", ".env"), "WOPAL_MEMORY_ENABLED=true\\n", "utf-8")
console.log(JSON.stringify({ capability: "setup.operation", apiVersion: 1, ok: true, data: { operation: "configure-memory", status: "created", result: {} } }))
`, "utf-8")
    const previousDevCliPath = process.env.WOPAL_DEV_CLI_PATH
    process.env.WOPAL_DEV_CLI_PATH = fakeCliPath

    // Setup space env with custom override WOPAL_MEMORY_ENABLED=true and non-memory OTHER_VAR
    const spaceEnvPath = join(spaceWopalDir, ".env")
    writeFileSync(spaceEnvPath, "WOPAL_MEMORY_ENABLED=true\nWOPAL_LLM_BASE_URL=https://space.api.com\nOTHER_VAR=value\n", "utf-8")

    const handlers = createOnboardingIpcHandlers({ homePath: testHome })

    // Execute memory-config with spaceMode: inherit
    try {
      await handlers["onboarding-execute-step"]({}, "memory-config", {
        scope: "space",
        spaceMode: "inherit",
        spacePath: spaceDir,
      })
    } finally {
      if (previousDevCliPath === undefined) {
        delete process.env.WOPAL_DEV_CLI_PATH
      } else {
        process.env.WOPAL_DEV_CLI_PATH = previousDevCliPath
      }
    }

    // Space env file MUST be preserved, with memory keys purged and other keys intact
    expect(existsSync(spaceEnvPath)).toBe(true)
    const spaceContent = readFileSync(spaceEnvPath, "utf-8")
    expect(spaceContent).not.toContain("WOPAL_MEMORY_ENABLED")
    expect(spaceContent).not.toContain("WOPAL_LLM_BASE_URL")
    expect(spaceContent).toContain("OTHER_VAR=value")

    // Global env MUST REMAIN WOPAL_MEMORY_ENABLED=false!
    const globalContent = readFileSync(globalEnvPath, "utf-8")
    expect(globalContent).toContain("WOPAL_MEMORY_ENABLED=false")
    expect(globalContent).not.toContain("WOPAL_MEMORY_ENABLED=true")
  })

  test("space memory disabled writes only the space override", async () => {
    const spaceDir = join(testHome, "space1")
    const spaceWopalDir = join(spaceDir, ".wopal")
    mkdirSync(spaceWopalDir, { recursive: true })
    const globalEnvPath = join(testHome, ".env")
    writeFileSync(globalEnvPath, "WOPAL_MEMORY_ENABLED=true\n", "utf-8")

    const handlers = createOnboardingIpcHandlers({ homePath: testHome })
    const result = await handlers["onboarding-execute-step"]({}, "memory-config", {
      enabled: false,
      scope: "space",
      spaceMode: "disabled",
      spacePath: spaceDir,
    })

    expect(result.status).toBe("completed")
    expect(readFileSync(join(spaceWopalDir, ".env"), "utf-8")).toContain("WOPAL_MEMORY_ENABLED=false")
    expect(readFileSync(globalEnvPath, "utf-8")).toContain("WOPAL_MEMORY_ENABLED=true")
  })

  test("space memory inherit clears targetEnvPath memory keys even if spacePath is omitted from payload", async () => {
    const spaceDir = join(testHome, "space1")
    const spaceWopalDir = join(spaceDir, ".wopal")
    mkdirSync(spaceWopalDir, { recursive: true })

    const globalEnvPath = join(testHome, ".env")
    writeFileSync(globalEnvPath, "WOPAL_MEMORY_ENABLED=false\n", "utf-8")

    const spaceEnvPath = join(spaceWopalDir, ".env")
    writeFileSync(spaceEnvPath, "WOPAL_MEMORY_ENABLED=true\nWOPAL_LLM_BASE_URL=https://space.api.com\n", "utf-8")

    // Mock probeWopalSpaceList to return spaceDir when detected
    const mockBin = join(testHome, "bin", process.platform === "win32" ? "wopal.exe" : "wopal")
    mkdirSync(join(testHome, "bin"), { recursive: true })
    writeFileSync(mockBin, "#!/bin/sh\necho '{\"ok\":true,\"data\":{\"items\":[{\"name\":\"space1\",\"path\":\"" + spaceDir + "\"}]}}'", { mode: 0o755 })

    const handlers = createOnboardingIpcHandlers({ homePath: testHome })

    // Execute memory-config without explicit spacePath in input payload (simulates payload missing spacePath)
    await handlers["onboarding-execute-step"]({}, "memory-config", {
      scope: "space",
      spaceMode: "inherit",
    })

    // Space env file is preserved, and memory keys cleared
    expect(existsSync(spaceEnvPath)).toBe(true)
    const spaceContent = readFileSync(spaceEnvPath, "utf-8")
    expect(spaceContent).not.toContain("WOPAL_MEMORY_ENABLED")
    expect(spaceContent).not.toContain("WOPAL_LLM_BASE_URL")
  })

  test("onboardingExecuteStep ontology-setup success marks step done without premature navigation", async () => {
    const executor = async () => ({ status: "completed" as const, result: {} })
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })
    const result = await handlers["onboarding-execute-step"]({}, "ontology-setup", { mode: "clone" })
    expect(result.status).toBe("completed")

    const state = readOnboardingState(testHome)
    expect(state?.steps["ontology-setup"]).toBe("done")
    expect(state?.currentStep).toBe("ontology-setup")
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

  test("onboardingExecuteStep create-space success marks step done without premature navigation", async () => {
    const executor = async () => ({ status: "completed" as const, result: {} })
    const handlers = createOnboardingIpcHandlers({ homePath: testHome, executeStep: executor })
    const result = await handlers["onboarding-execute-step"]({}, "create-space", { path: "/tmp/ws" })
    expect(result.status).toBe("completed")

    const state = readOnboardingState(testHome)
    expect(state?.steps["create-space"]).toBe("done")
    expect(state?.currentStep).toBe("create-space")
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

  test("onboarding logger degrades safely when its home path is not a directory", () => {
    const blockedHome = join(testHome, "blocked-home")
    writeFileSync(blockedHome, "not a directory")

    expect(() => {
      const logger = getOnboardingLogger(blockedHome)
      logger.log("must not interrupt onboarding")
    }).not.toThrow()
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
