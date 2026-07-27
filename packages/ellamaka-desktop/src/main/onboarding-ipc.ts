import { resolveOnboardingMode } from "./onboarding-gate"
import {
  createDefaultOnboardingState,
  markCompleted,
  markStarted,
  ONBOARDING_STEPS,
  readOnboardingState,
  updateStep,
  writeOnboardingState,
  advanceToNextStep,
  type OnboardingStepName,
} from "./onboarding-state"
import { installWopalCli } from "./bootstrap-installer"
import { runSetupOperation } from "./setup-machine-client"
import { spawnSync } from "node:child_process"
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { getUserShell, loadShellEnv } from "./shell-env"
import type { OnboardingStepResult } from "../preload/types"

import { statfsSync } from "node:fs"
import { getOnboardingLogger } from "./onboarding-logger"

export async function performSystemCheck(homePath: string): Promise<OnboardingStepResult> {
  // 1. Check Git binary
  let gitVersion: string | null = null
  try {
    const check = spawnSync("git", ["--version"])
    if (check.status === 0) {
      gitVersion = check.stdout.toString().trim()
    }
  } catch {}

  if (!gitVersion) {
    return {
      status: "failed",
      error: {
        code: "GIT_NOT_FOUND",
        message: "Git CLI binary was not found on system PATH. WopalSpace requires Git. Please install Git and try again.",
      },
    }
  }

  // 2. Check WOPAL_HOME writable
  try {
    if (!existsSync(homePath)) {
      mkdirSync(homePath, { recursive: true })
    }
    accessSync(homePath, constants.W_OK)
  } catch (err) {
    return {
      status: "failed",
      error: {
        code: "WOPAL_HOME_NOT_WRITABLE",
        message: `Target WOPAL_HOME directory '${homePath}' is not writable: ${err instanceof Error ? err.message : String(err)}`,
      },
    }
  }

  // 3. Check Network connectivity to R2 CDN
  let networkOk = false
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    const res = await fetch("https://download.coursedao.com/wopal-cli/latest/manifest.json", {
      method: "HEAD",
      signal: controller.signal,
    })
    clearTimeout(timer)
    networkOk = res.ok || res.status < 500
  } catch {
    networkOk = false
  }

  if (!networkOk) {
    return {
      status: "failed",
      error: {
        code: "NETWORK_OFFLINE",
        message: "Failed to connect to Wopal release CDN (download.coursedao.com). Please check your internet connection.",
      },
    }
  }

  // 4. Check 500MB disk space
  try {
    const stat = statfsSync(homePath)
    const freeSpace = stat.bavail * stat.bsize
    if (freeSpace < 500 * 1024 * 1024) {
      return {
        status: "failed",
        error: {
          code: "INSUFFICIENT_DISK_SPACE",
          message: `Insufficient disk space. Required: 500MB. Available: ${(freeSpace / 1024 / 1024).toFixed(1)}MB`,
        },
      }
    }
  } catch (err) {
    // Ignore statfs errors (e.g. on unsupported systems)
  }

  return {
    status: "completed",
    result: {
      platform: process.platform,
      arch: process.arch,
      embeddedNodeVersion: process.version,
      gitVersion,
      networkStatus: "Connected (R2 CDN Reachable)",
      wopalHome: homePath,
    },
  }
}

export function detectGithubToken(homePath?: string): { token: string; source: string } | null {
  if (process.env.GITHUB_TOKEN?.trim()) {
    return { token: process.env.GITHUB_TOKEN.trim(), source: "GITHUB_TOKEN (environment)" }
  }

  if (process.env.GH_TOKEN?.trim()) {
    return { token: process.env.GH_TOKEN.trim(), source: "GH_TOKEN (environment)" }
  }

  try {
    const userShell = getUserShell()
    const shellEnv = loadShellEnv(userShell)
    if (shellEnv?.GITHUB_TOKEN?.trim()) {
      return { token: shellEnv.GITHUB_TOKEN.trim(), source: "GITHUB_TOKEN (user shell profile)" }
    }
    if (shellEnv?.GH_TOKEN?.trim()) {
      return { token: shellEnv.GH_TOKEN.trim(), source: "GH_TOKEN (user shell profile)" }
    }
  } catch {}

  try {
    const res = spawnSync("gh", ["auth", "token"], { stdio: "pipe" })
    if (res.status === 0 && res.stdout) {
      const token = res.stdout.toString().trim()
      if (token) return { token, source: "gh CLI toolchain (authenticated)" }
    }
  } catch {}

  const envPath = join(homePath ?? join(homedir(), ".wopal"), ".env")
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf-8")
      const match = content.match(/^GITHUB_TOKEN=(.+)$/m) || content.match(/^GH_TOKEN=(.+)$/m)
      if (match && match[1]?.trim()) {
        const val = match[1].trim().replace(/^["']|["']$/g, "")
        if (val) return { token: val, source: "WOPAL_HOME/.env" }
      }
    } catch {}
  }

  return null
}

export function detectProviderAuth(homePath?: string, providerId = "opencode"): string | undefined {
  const authPath = join(homePath ?? join(homedir(), ".wopal"), "ellamaka", "data", "auth.json")
  if (existsSync(authPath)) {
    try {
      const content = readFileSync(authPath, "utf-8")
      const parsed = JSON.parse(content)
      if (parsed && parsed[providerId]?.key) return parsed[providerId].key
    } catch {}
  }
}

export function normalizeSetupResult(opRes: OnboardingStepResult): OnboardingStepResult {
  const raw = opRes.status as string
  if (raw === "completed") {
    return { status: "completed", result: opRes.result, error: opRes.error }
  }
  if (raw === "reused") {
    return { status: "reused", result: opRes.result, error: opRes.error }
  }
  if (raw === "skipped") {
    return { status: "skipped", result: opRes.result, error: opRes.error }
  }
  return { status: "failed", result: opRes.result, error: opRes.error }
}

export function buildMemoryOperationInput(input?: unknown): Record<string, unknown> {
  const payload = (input as Record<string, unknown> | undefined) ?? {}
  if (payload.skip || payload.enabled === false) return { enabled: false }

  const result: Record<string, unknown> = { enabled: true }
  for (const field of [
    "llmEndpoint",
    "llmKey",
    "llmModel",
    "embeddingEndpoint",
    "embeddingKey",
    "embeddingModel",
  ]) {
    if (typeof payload[field] === "string" && payload[field]) result[field] = payload[field]
  }
  return result
}

export type StepExecutor = (
  step: OnboardingStepName | "inspect",
  input?: unknown,
  onProgress?: (progress: any) => void,
) => Promise<OnboardingStepResult>

export interface OnboardingIpcDeps {
  homePath?: string
  executeStep?: StepExecutor
  broadcastProgress?: (progress: any) => void
}

const STEP_OPERATION_LABELS: Record<OnboardingStepName, string> = {
  "system-check": "检查系统环境",
  "install-wopal-cli": "安装或复用 Wopal CLI",
  "install-ellamaka-cli": "安装或复用 Ellamaka 引擎",
  "github-auth": "配置 GitHub 认证",
  "ai-provider": "配置 AI Provider",
  "ontology-setup": "准备能力本体",
  "runtime-setup": "安装配置本体能力",
  "create-space": "创建或复用工作空间",
  "memory-config": "配置记忆系统",
  "star-guide": "处理 GitHub Star",
}

export function createOnboardingIpcHandlers(deps: OnboardingIpcDeps = {}) {
  let currentOperation: Promise<OnboardingStepResult> | null = null

  const defaultExecuteStep: StepExecutor = async (step, input, onProgress) => {
    const homePath = deps.homePath ?? process.env.WOPAL_HOME ?? join(homedir(), ".wopal")
    process.env.WOPAL_HOME = homePath
    
    const logger = getOnboardingLogger(homePath)
    logger.log(`Executing step: ${step}`)
    
    const isWin = process.platform === "win32"
    const binPath = join(homePath, "bin", isWin ? "wopal.exe" : "wopal")

switch (step) {
        case "inspect":
          return normalizeSetupResult(await runSetupOperation({
            binaryPath: binPath,
            operation: "inspect",
            input: {},
            onProgress,
          }))

        case "system-check":
          return performSystemCheck(homePath)

        case "install-wopal-cli":
          return installWopalCli({
            homePath,
            forceUpgrade: (input as Record<string, unknown> | undefined)?.forceUpgrade as boolean | undefined,
            onProgress,
          })

        case "install-ellamaka-cli": {
          const payload = (input as Record<string, unknown>) ?? {}
          delete payload.homePath
          delete payload.forkUrl
          return normalizeSetupResult(await runSetupOperation({
            binaryPath: binPath,
            operation: "install-engine",
            input: payload,
            onProgress,
          }))
        }

        case "github-auth": {
          const payload = (input as Record<string, unknown>) ?? {}
          if (payload.skip) {
            return { status: "skipped" }
          }
          const token = (payload.token as string | undefined)?.trim() || detectGithubToken(homePath)?.token
          if (!token) {
            return { status: "skipped" }
          }
          return normalizeSetupResult(await runSetupOperation({
            binaryPath: binPath,
            operation: "configure-github",
            input: { token },
            onProgress,
          }))
        }

        case "ai-provider": {
          const payload = (input as Record<string, unknown>) ?? {}
          const providerId = (payload.provider as string) || (payload.providerId as string) || "opencode"

          const apiKey = (payload.apiKey as string | undefined)?.trim() || detectProviderAuth(homePath, providerId)

          if (payload.skip || !apiKey) {
            return { status: "skipped" }
          }

          return normalizeSetupResult(await runSetupOperation({
            binaryPath: binPath,
            operation: "configure-provider",
            input: { providerId, apiKey },
            onProgress,
          }))
        }

        case "ontology-setup": {
          const payload = (input as Record<string, unknown>) ?? {}
          const mode = (payload.mode as string) === "fork" ? "fork" : "clone"
          const source = payload.source as string | undefined
          const opInput: Record<string, unknown> = { mode }
          if (source) opInput.source = source
          return normalizeSetupResult(await runSetupOperation({
            binaryPath: binPath,
            operation: "prepare-ontology",
            input: opInput,
            onProgress,
          }))
        }

        case "runtime-setup":
          return normalizeSetupResult(await runSetupOperation({
            binaryPath: binPath,
            operation: "prepare-runtime",
            input: {},
            onProgress,
          }))

        case "create-space": {
          const payload = (input as Record<string, unknown>) ?? {}
          if (payload.skip) {
            // Verify existing spaces before allowing skip
            const inspectRes = await runSetupOperation({
              binaryPath: binPath,
              operation: "inspect",
              input: {},
            })
            const spaces = (inspectRes.result as any)?.spaces ?? []
            if (spaces.length === 0) {
              return {
                status: "failed",
                error: { code: "NO_EXISTING_SPACE", message: "Cannot skip space creation on a fresh environment. At least one Space must be registered." },
              }
            }
            return { status: "skipped" }
          }
          const path = payload.path as string
          if (!path) {
            return { status: "failed", error: { code: "INVALID_INPUT", message: "Space path is required." } }
          }
          return normalizeSetupResult(await runSetupOperation({
            binaryPath: binPath,
            operation: "initialize-space",
            input: { path, type: (payload.type as string) || undefined },
            onProgress,
          }))
        }

        case "memory-config": {
          return normalizeSetupResult(await runSetupOperation({
            binaryPath: binPath,
            operation: "configure-memory",
            input: buildMemoryOperationInput(input),
            onProgress,
          }))
        }

        case "star-guide": {
          const payload = (input as Record<string, unknown>) ?? {}
          if (payload.skip) return { status: "skipped" }
          return normalizeSetupResult(await runSetupOperation({
            binaryPath: binPath,
            operation: "star",
            input: { repo: "wopal-cn/wopal-space-ontology", accepted: true, browserFallback: true },
            onProgress,
          }))
        }

        default:
          return { status: "failed", error: { code: "ONBOARDING_STEP_INVALID", message: `Unknown step: ${step}` } }
      }
  }

  return {
    "get-onboarding-mode": async () => {
      const mode = resolveOnboardingMode(deps.homePath)
      return { mode }
    },

    "onboarding-get-state": async () => {
      return readOnboardingState(deps.homePath)
    },

    "onboarding-probe": async (_event: unknown, kind: string) => {
        const homePath = deps.homePath ?? process.env.WOPAL_HOME ?? join(homedir(), ".wopal")
        process.env.WOPAL_HOME = homePath
        const isWin = process.platform === "win32"
        const binPath = join(homePath, "bin", isWin ? "wopal.exe" : "wopal")

        switch (kind) {
          case "github-auth": {
            const detectedInfo = detectGithubToken(homePath)
            return {
              detected: !!detectedInfo,
              source: detectedInfo?.source ?? null,
              maskedToken: detectedInfo
                ? `${detectedInfo.token.slice(0, 4)}...${detectedInfo.token.slice(-4)}`
                : null,
            }
          }
          case "ai-provider": {
            const existingKey = detectProviderAuth(homePath, "opencode")
            return {
              hasKey: !!existingKey,
              maskedKey: existingKey ? `${existingKey.slice(0, 3)}...${existingKey.slice(-4)}` : null,
            }
          }
          case "runtime": {
            try {
              const executor = deps.executeStep ?? defaultExecuteStep
              const res = await executor("inspect")
              if (res.status === "failed") {
                return {
                  ready: false,
                  homePath,
                  error: res.error?.message ?? "无法检查本体能力配置。",
                }
              }
              const runtime = res.result?.runtime
              if (!runtime || typeof runtime !== "object") {
                return {
                  ready: false,
                  homePath,
                  error: typeof res.result?.error === "string"
                    ? res.result.error
                    : "检查结果缺少本体能力状态。",
                }
              }
              return runtime
            } catch (err) {
              return {
                ready: false,
                homePath,
                error: err instanceof Error ? err.message : String(err),
              }
            }
          }
          case "environment": {
            try {
              const executor = deps.executeStep ?? defaultExecuteStep
              const res = await executor("inspect")
              if (res.status === "failed") {
                return {
                  availableTypes: [],
                  spaces: [],
                  ontologyInstalled: false,
                  ontologyMode: null,
                  homePath,
                  defaultSpacePath: join(homedir(), "WopalSpace"),
                  error: res.error?.message ?? "无法检查工作空间环境。",
                  errorCode: res.error?.code ?? "ENVIRONMENT_INSPECT_FAILED",
                }
              }
              const hasAvailableTypes = Array.isArray(res.result?.availableTypes)
              const availableTypes = hasAvailableTypes
                ? res.result?.availableTypes
                : [{ type: "common", branch: "main" }]
              return {
                availableTypes,
                spaces: res.result?.spaces ?? [],
                ontologyInstalled: res.result?.ontologyInstalled ?? false,
                ontologyMode: res.result?.ontologyMode ?? null,
                homePath,
                defaultSpacePath: join(homedir(), "WopalSpace"),
                legacyContract: !hasAvailableTypes,
              }
            } catch (err) {
              return {
                availableTypes: [],
                spaces: [],
                ontologyInstalled: false,
                ontologyMode: null,
                homePath,
                defaultSpacePath: join(homedir(), "WopalSpace"),
                error: err instanceof Error ? err.message : String(err),
                errorCode: "ENVIRONMENT_INSPECT_FAILED",
              }
            }
          }
          case "memory": {
            try {
              const executor = deps.executeStep ?? defaultExecuteStep
              const res = await executor("inspect")
              if (res.status === "failed") {
                return {
                  state: "unconfigured",
                  enabled: false,
                  envPath: join(homePath, ".env"),
                  error: res.error?.message ?? "无法检查记忆配置。",
                }
              }
              const memory = (res.result?.memory ?? {}) as Record<string, unknown>
              return memory
            } catch (err) {
              return {
                state: "unconfigured",
                enabled: false,
                envPath: join(homePath, ".env"),
                error: err instanceof Error ? err.message : String(err),
              }
            }
          }
          default:
            return { error: "Unknown probe kind" }
        }
      },

      "onboarding-execute-step": async (
      _event: unknown,
      stepName: OnboardingStepName,
      input?: unknown,
    ): Promise<OnboardingStepResult> => {
      if (!ONBOARDING_STEPS.includes(stepName)) {
        return {
          status: "failed",
          error: {
            code: "ONBOARDING_STEP_INVALID",
            message: `Invalid step name: ${stepName}`,
          },
        }
      }

      if (currentOperation !== null) {
        try {
          await currentOperation
        } catch {
          // ignore previous operation error
        }
      }

      const run = async (): Promise<OnboardingStepResult> => {
        const logger = getOnboardingLogger(deps.homePath)
        const operationLabel = STEP_OPERATION_LABELS[stepName]
        const startingMessage = `开始${operationLabel}…`
        logger.log(`[${stepName}] ${startingMessage}`)
        deps.broadcastProgress?.({
          step: stepName,
          phase: "starting",
          message: startingMessage,
        })
        let state = readOnboardingState(deps.homePath) ?? createDefaultOnboardingState()
        state = markStarted(state)
        state = updateStep(state, stepName, "in-progress")
        writeOnboardingState(state, deps.homePath)

        try {
          const executor = deps.executeStep ?? defaultExecuteStep
          const res = await executor(stepName, input, (p) => deps.broadcastProgress?.({ step: stepName, ...p }))

          state = readOnboardingState(deps.homePath) ?? state
          if (res.status === "completed" || res.status === "reused") {
            state = updateStep(state, stepName, "done")
            state = advanceToNextStep(state, stepName)
          } else if (res.status === "skipped") {
            state = updateStep(state, stepName, "skipped")
            state = advanceToNextStep(state, stepName)
          } else {
            state = updateStep(state, stepName, "failed", res.error?.message ?? "Execution failed")
          }

          writeOnboardingState(state, deps.homePath)
          if (res.status === "failed") {
            const code = res.error?.code ?? "STEP_FAILED"
            const message = res.error?.message ?? "执行失败"
            const failureMessage = `${operationLabel}失败 [${code}]: ${message}`
            const diagnostics = [
              failureMessage,
              res.error?.suggestion ? `Suggestion: ${res.error.suggestion}` : "",
              res.error?.details ?? "",
            ].filter(Boolean).join("\n")
            logger.log(`[${stepName}] ${diagnostics}`)
            deps.broadcastProgress?.({
              step: stepName,
              phase: "failed",
              message: failureMessage,
              suggestion: res.error?.suggestion,
              details: res.error?.details,
            })
          } else {
            const completionMessage = `${operationLabel}完成（${res.status}）`
            logger.log(`[${stepName}] ${completionMessage}`)
            deps.broadcastProgress?.({
              step: stepName,
              phase: "completed",
              message: completionMessage,
            })
          }
          return res
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          const failureMessage = `${operationLabel}失败 [STEP_EXECUTION_ERROR]: ${msg}`
          const details = err instanceof Error ? err.stack : undefined
          logger.log(`[${stepName}] ${failureMessage}${details ? `\n${details}` : ""}`)
          deps.broadcastProgress?.({
            step: stepName,
            phase: "failed",
            message: failureMessage,
            details,
          })
          state = updateStep(state, stepName, "failed", msg)
          writeOnboardingState(state, deps.homePath)
          return {
            status: "failed",
            error: { code: "STEP_EXECUTION_ERROR", message: msg, details },
          }
        } finally {
          currentOperation = null
        }
      }

      currentOperation = run()
      return currentOperation
    },

    "onboarding-complete": async () => {
      const executor = deps.executeStep ?? defaultExecuteStep
      let readiness: OnboardingStepResult
      try {
        readiness = await executor("inspect")
      } catch (err) {
        return {
          status: "failed" as const,
          error: {
            code: "ONBOARDING_READINESS_CHECK_FAILED",
            message: err instanceof Error ? err.message : String(err),
          },
        }
      }

      if (readiness.status === "failed") {
        return {
          status: "failed" as const,
          error: {
            code: "ONBOARDING_READINESS_CHECK_FAILED",
            message: readiness.error?.message ?? "Unable to verify Wopal runtime readiness.",
          },
        }
      }

      if (readiness.result?.verdict !== "healthy") {
        return {
          status: "failed" as const,
          result: readiness.result,
          error: {
            code: "ONBOARDING_NOT_READY",
            message: String(readiness.result?.verdictReason ?? "Wopal runtime is not healthy yet."),
          },
        }
      }

      let state = readOnboardingState(deps.homePath) ?? createDefaultOnboardingState()
      state = markCompleted(state)
      if (!writeOnboardingState(state, deps.homePath)) {
        return {
          status: "failed" as const,
          error: {
            code: "ONBOARDING_STATE_WRITE_FAILED",
            message: "Runtime is healthy, but the onboarding completion state could not be saved.",
          },
        }
      }
      return { status: "completed" as const, result: readiness.result }
    },
  }
}
