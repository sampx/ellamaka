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
  rewindToStep,
  navigateToStep,
  setCurrentStep,
  type OnboardingStepName,
} from "./onboarding-state"
import { installWopalCli } from "./bootstrap-installer"
import { runSetupOperation } from "./setup-machine-client"
import { spawnSync } from "node:child_process"
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir, userInfo } from "node:os"
import { getUserShell, loadShellEnv } from "./shell-env"
import type { OnboardingStepResult } from "../preload/types"

import { statfsSync } from "node:fs"
import { getOnboardingLogger } from "./onboarding-logger"
import { getReleaseInfo } from "./release-info"

export function resolveSystemUserName(): string {
  try {
    const res = spawnSync("git", ["config", "user.name"], { encoding: "utf8" })
    if (res.status === 0 && res.stdout?.trim()) {
      return res.stdout.trim()
    }
  } catch {}

  try {
    const info = userInfo()
    if (info?.username?.trim()) {
      return info.username.trim()
    }
  } catch {}

  return process.env.USER || process.env.USERNAME || process.env.LOGNAME || ""
}

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

  // 3. Check Network connectivity to R2 CDN (with fallback & tolerant timeout)
  let networkOk = false
  const cdnUrl = "https://download.coursedao.com/wopal-cli/latest/manifest.json"
  
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(cdnUrl, {
        method: attempt === 0 ? "HEAD" : "GET",
        headers: attempt === 1 ? { Range: "bytes=0-0" } : undefined,
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (res.ok || res.status < 500) {
        networkOk = true
        break
      }
    } catch {
      // Retry next attempt
    }
  }

  // Fallback check to general internet if CDN attempt timed out
  if (!networkOk) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      const res = await fetch("https://1.1.1.1", { method: "HEAD", signal: controller.signal })
      clearTimeout(timer)
      if (res.ok || res.status < 500) {
        // General internet is reachable, tolerate CDN latency warning
        networkOk = true
      }
    } catch {
      networkOk = false
    }
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
      userName: resolveSystemUserName(),
    },
  }
}

export interface GithubTokenDetectionDeps {
  env?: NodeJS.ProcessEnv
  loadUserShellEnv?: () => NodeJS.ProcessEnv
  readGhToken?: () => string | null
}

export interface GithubCliProbe {
  installed: boolean
  authenticated: boolean
  account: string | null
}

export interface GithubAuthenticationProbeDeps extends GithubTokenDetectionDeps {
  probeGhCli?: () => GithubCliProbe
  verifyGithubToken?: (token: string) => Promise<{ account: string | null; valid: boolean }>
}

function probeGithubCli(): GithubCliProbe {
  const version = spawnSync("gh", ["--version"], { stdio: "pipe", timeout: 3000 })
  if (version.status !== 0) {
    return { installed: false, authenticated: false, account: null }
  }

  const env = { ...process.env }
  delete env.GITHUB_TOKEN
  delete env.GH_TOKEN
  const auth = spawnSync("gh", ["auth", "token"], { stdio: "pipe", env, timeout: 3000 })
  if (auth.status !== 0 || !auth.stdout?.toString().trim()) {
    return { installed: true, authenticated: false, account: null }
  }

  const accountResult = spawnSync("gh", ["api", "user", "--jq", ".login"], { stdio: "pipe", env, timeout: 5000 })
  const account = accountResult.status === 0 ? accountResult.stdout?.toString().trim() || null : null
  return { installed: true, authenticated: true, account }
}

export async function verifyGithubTokenViaApi(token: string): Promise<{ account: string | null; valid: boolean }> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ellamaka-onboarding",
      },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { account: null, valid: false }
    const data = (await res.json()) as { login?: string }
    const account = data.login?.trim()
    return { account: account || null, valid: Boolean(account) }
  } catch {
    return { account: null, valid: false }
  }
}

export async function probeGithubAuthentication(
  homePath?: string,
  deps: GithubAuthenticationProbeDeps = {},
) {
  const tokenInfo = detectGithubToken(homePath, {
    env: deps.env,
    loadUserShellEnv: deps.loadUserShellEnv,
    readGhToken: () => null,
  })
  const ghCli = deps.probeGhCli ? deps.probeGhCli() : probeGithubCli()

  if (ghCli.authenticated) {
    return {
      detected: true,
      source: "gh-cli" as const,
      account: ghCli.account,
      ghCliInstalled: ghCli.installed,
      ghCliAuthenticated: ghCli.authenticated,
      tokenConfigured: tokenInfo !== null,
      tokenSource: tokenInfo?.source ?? null,
    }
  }

  if (!tokenInfo) {
    return {
      detected: false,
      source: null,
      account: null,
      ghCliInstalled: ghCli.installed,
      ghCliAuthenticated: ghCli.authenticated,
      tokenConfigured: false,
      tokenSource: null,
    }
  }

  const verify = deps.verifyGithubToken ?? verifyGithubTokenViaApi
  const verification = await verify(tokenInfo.token)
  if (!verification.valid) {
    return {
      detected: false,
      source: null,
      account: null,
      ghCliInstalled: ghCli.installed,
      ghCliAuthenticated: ghCli.authenticated,
      tokenConfigured: true,
      tokenSource: tokenInfo.source,
    }
  }

  return {
    detected: true,
    source: tokenInfo.source,
    account: verification.account,
    ghCliInstalled: ghCli.installed,
    ghCliAuthenticated: ghCli.authenticated,
    tokenConfigured: true,
    tokenSource: tokenInfo.source,
  }
}

export function detectGithubToken(
  homePath?: string,
  deps: GithubTokenDetectionDeps = {},
): { token: string; source: string } | null {
  const env = deps.env ?? process.env
  if (env.GITHUB_TOKEN?.trim()) {
    return { token: env.GITHUB_TOKEN.trim(), source: "github-token-env" }
  }

  if (env.GH_TOKEN?.trim()) {
    return { token: env.GH_TOKEN.trim(), source: "gh-token-env" }
  }

  try {
    const shellEnv = deps.loadUserShellEnv
      ? deps.loadUserShellEnv()
      : loadShellEnv(getUserShell())
    if (shellEnv?.GITHUB_TOKEN?.trim()) {
      return { token: shellEnv.GITHUB_TOKEN.trim(), source: "github-token-shell" }
    }
    if (shellEnv?.GH_TOKEN?.trim()) {
      return { token: shellEnv.GH_TOKEN.trim(), source: "gh-token-shell" }
    }
  } catch {}

  try {
    const token = deps.readGhToken
      ? deps.readGhToken()
      : (() => {
          const res = spawnSync("gh", ["auth", "token"], { stdio: "pipe", timeout: 3000 })
          return res.status === 0 && res.stdout ? res.stdout.toString().trim() : null
        })()
    if (token) return { token, source: "gh-cli" }
  } catch {}

  const envPath = join(homePath ?? join(homedir(), ".wopal"), ".env")
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf-8")
      const match = content.match(/^(GITHUB_TOKEN|GH_TOKEN)=(.+)$/m)
      if (match && match[1]?.trim()) {
        const val = match[2]?.trim().replace(/^["']|["']$/g, "")
        if (val) {
          return {
            token: val,
            source: match[1] === "GH_TOKEN" ? "wopal-gh-token" : "wopal-github-token",
          }
        }
      }
    } catch {}
  }

  return null
}

export function detectProviderAuth(homePath?: string, providerId = "opencode-go"): string | undefined {
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

export function probeWopalSpaceList(binPath: string, env?: Record<string, string>): Array<{ name: string; path: string; type?: string | null }> {
  try {
    if (!existsSync(binPath)) return []
    const res = spawnSync(binPath, ["space", "list", "--json", "--api-version", "1"], {
      env: { ...process.env, ...env },
      encoding: "utf-8",
      timeout: 3000,
    })
    if (res.status === 0 && res.stdout) {
      const parsed = JSON.parse(res.stdout)
      if (parsed?.ok && Array.isArray(parsed?.data?.items)) {
        return parsed.data.items.map((item: any) => ({
          name: item.name ?? String(item.path).split("/").filter(Boolean).at(-1) ?? "Space",
          path: item.path,
          type: item.type ?? "common",
        }))
      }
    }
  } catch {}
  return []
}

export function readEnvConfig(envPath: string) {
  if (!existsSync(envPath)) return null
  try {
    const text = readFileSync(envPath, "utf-8")
    const envVars: Record<string, string> = {}
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith("#")) {
        const idx = trimmed.indexOf("=")
        if (idx > 0) {
          const key = trimmed.slice(0, idx).trim()
          let val = trimmed.slice(idx + 1).trim()
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
          }
          envVars[key] = val
        }
      }
    }

    const enabled = envVars["WOPAL_MEMORY_ENABLED"] !== "false"
    const memoryInjectionEnabled = envVars["WOPAL_MEMORY_INJECTION_ENABLED"] !== "false"
    const llmEndpoint = envVars["WOPAL_LLM_BASE_URL"] || envVars["WOPAL_MEMORY_LLM_ENDPOINT"] || ""
    const llmModel = envVars["WOPAL_LLM_MODEL"] || envVars["WOPAL_MEMORY_LLM_MODEL"] || ""
    const embeddingEndpoint = envVars["WOPAL_EMBEDDING_BASE_URL"] || envVars["WOPAL_MEMORY_EMBEDDING_ENDPOINT"] || ""
    const embeddingModel = envVars["WOPAL_EMBEDDING_MODEL"] || envVars["WOPAL_MEMORY_EMBEDDING_MODEL"] || ""
    const hasLlmKey = Boolean(envVars["WOPAL_LLM_API_KEY"] || envVars["WOPAL_MEMORY_LLM_KEY"])
    const hasEmbeddingKey = Boolean(envVars["WOPAL_EMBEDDING_API_KEY"] || envVars["WOPAL_MEMORY_EMBEDDING_KEY"] || envVars["WOPAL_LLM_API_KEY"])

    const hasAnyConfig =
      "WOPAL_MEMORY_ENABLED" in envVars ||
      Boolean(llmEndpoint || llmModel || embeddingModel || hasLlmKey)

    if (!hasAnyConfig) return null

    return {
      enabled,
      memoryInjectionEnabled,
      envPath,
      llmEndpoint,
      llmModel,
      embeddingEndpoint,
      embeddingModel,
      hasLlmKey,
      hasEmbeddingKey,
    }
  } catch {
    return null
  }
}

export interface MemoryConfigDetectionDeps {
  listSpaces?: typeof probeWopalSpaceList
}

export function detectMemoryConfig(homePath: string, deps: MemoryConfigDetectionDeps = {}) {
  const globalEnvPath = join(homePath, ".env")
  const globalConfig = readEnvConfig(globalEnvPath)

  let activeSpace: { name: string; path: string; type?: string | null } | null = null
  try {
    const isWin = process.platform === "win32"
    const binPath = join(homePath, "bin", isWin ? "wopal.exe" : "wopal")
    const spaces = (deps.listSpaces ?? probeWopalSpaceList)(binPath, { WOPAL_HOME: homePath })
    if (spaces.length > 0) {
      activeSpace = spaces[0]
    }
  } catch {}

  let spaceConfig: ReturnType<typeof readEnvConfig> = null
  if (activeSpace?.path) {
    spaceConfig = readEnvConfig(join(activeSpace.path, ".wopal", ".env"))
  }

  const effective = spaceConfig ?? globalConfig

  if (!effective && !globalConfig && !spaceConfig) {
    if (!activeSpace) return null
    return {
      state: "unconfigured" as const,
      enabled: false,
      memoryInjectionEnabled: true,
      envPath: globalEnvPath,
      llmEndpoint: "",
      llmModel: "",
      embeddingEndpoint: "",
      embeddingModel: "",
      hasLlmKey: false,
      hasEmbeddingKey: false,
      globalMemory: null,
      spaceMemory: null,
      effectiveSpace: activeSpace,
    }
  }

  const isReady = Boolean(
    effective &&
    effective.enabled &&
    (effective.llmEndpoint || effective.llmModel || effective.hasLlmKey)
  )
  const state = !effective ? "unconfigured" : !effective.enabled ? "disabled" : isReady ? "ready" : "incomplete"

  return {
    state,
    enabled: effective?.enabled ?? false,
    envPath: effective?.envPath ?? globalEnvPath,
    llmEndpoint: effective?.llmEndpoint ?? globalConfig?.llmEndpoint ?? "",
    llmModel: effective?.llmModel ?? globalConfig?.llmModel ?? "",
    embeddingEndpoint: effective?.embeddingEndpoint ?? globalConfig?.embeddingEndpoint ?? "",
    embeddingModel: effective?.embeddingModel ?? globalConfig?.embeddingModel ?? "",
    hasLlmKey: effective?.hasLlmKey ?? globalConfig?.hasLlmKey ?? false,
    hasEmbeddingKey: effective?.hasEmbeddingKey ?? globalConfig?.hasEmbeddingKey ?? false,
    globalMemory: globalConfig ? { ...globalConfig, state: globalConfig.enabled ? "ready" : "disabled" } : null,
    spaceMemory: spaceConfig ? { ...spaceConfig, state: spaceConfig.enabled ? "ready" : "disabled" } : null,
    effectiveSpace: activeSpace,
  }
}

export interface LocalCliProbeResult {
  installed: boolean
  binaryPath: string
  version?: string
  errorCode?: "CLI_BINARY_BROKEN"
  error?: string
}

export function probeLocalCli(
  binaryPath: string,
  deps: {
    exists?: (path: string) => boolean
    readVersion?: (path: string) => { status: number | null; stdout?: string | Buffer }
  } = {},
): LocalCliProbeResult {
  const binaryExists = deps.exists ?? existsSync
  if (!binaryExists(binaryPath)) {
    return { installed: false, binaryPath }
  }

  const readVersion = deps.readVersion ?? ((path: string) => spawnSync(path, ["--version"], { encoding: "utf8" }))
  try {
    const result = readVersion(binaryPath)
    if (result.status === 0) {
      const version = String(result.stdout ?? "").trim()
      return {
        installed: true,
        binaryPath,
        ...(version ? { version } : {}),
      }
    }
  } catch {}

  return {
    installed: false,
    binaryPath,
    errorCode: "CLI_BINARY_BROKEN",
    error: `检测到 CLI 文件，但无法执行版本检查：${binaryPath}`,
  }
}

export function clearSpaceMemoryEnvFile(targetEnvPath: string): boolean {
  try {
    if (!existsSync(targetEnvPath)) return true
    const text = readFileSync(targetEnvPath, "utf-8")
    const memoryKeys = new Set([
      "WOPAL_MEMORY_ENABLED",
      "WOPAL_MEMORY_INJECTION_ENABLED",
      "WOPAL_LLM_BASE_URL",
      "WOPAL_LLM_MODEL",
      "WOPAL_LLM_API_KEY",
      "WOPAL_MEMORY_LLM_ENDPOINT",
      "WOPAL_MEMORY_LLM_MODEL",
      "WOPAL_MEMORY_LLM_KEY",
      "WOPAL_EMBEDDING_BASE_URL",
      "WOPAL_EMBEDDING_MODEL",
      "WOPAL_EMBEDDING_API_KEY",
      "WOPAL_MEMORY_EMBEDDING_ENDPOINT",
      "WOPAL_MEMORY_EMBEDDING_MODEL",
      "WOPAL_MEMORY_EMBEDDING_KEY",
    ])

    const remainingLines: string[] = []
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const idx = trimmed.indexOf("=")
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim()
        if (!memoryKeys.has(key)) {
          remainingLines.push(line)
        }
      }
    }

    // Never delete the .env file — only clear memory keys and rewrite remaining lines
    writeFileSync(targetEnvPath, remainingLines.length > 0 ? remainingLines.join("\n") + "\n" : "", "utf-8")
    return true
  } catch (err) {
    console.error(`[onboarding-ipc] Failed to clear space memory env file at ${targetEnvPath}:`, err)
    return false
  }
}

export function writeMemoryEnvFile(
  targetEnvPath: string,
  payload: Record<string, unknown>,
  homePath?: string,
): boolean {
  try {
    const dir = join(targetEnvPath, "..")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    let envVars: Record<string, string> = {}
    if (existsSync(targetEnvPath)) {
      const text = readFileSync(targetEnvPath, "utf-8")
      for (const line of text.split("\n")) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith("#")) {
          const idx = trimmed.indexOf("=")
          if (idx > 0) {
            envVars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
          }
        }
      }
    }

    // Read global env vars for fallback key inheritance if writing to a space file
    let globalEnvVars: Record<string, string> = {}
    if (homePath) {
      const globalEnvPath = join(homePath, ".env")
      if (existsSync(globalEnvPath) && globalEnvPath !== targetEnvPath) {
        const globalText = readFileSync(globalEnvPath, "utf-8")
        for (const line of globalText.split("\n")) {
          const trimmed = line.trim()
          if (trimmed && !trimmed.startsWith("#")) {
            const idx = trimmed.indexOf("=")
            if (idx > 0) {
              globalEnvVars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
            }
          }
        }
      }
    }

    if (payload.enabled === false) {
      envVars["WOPAL_MEMORY_ENABLED"] = "false"
      delete envVars["WOPAL_MEMORY_INJECTION_ENABLED"]
    } else {
      envVars["WOPAL_MEMORY_ENABLED"] = "true"
      envVars["WOPAL_MEMORY_INJECTION_ENABLED"] = payload.memoryInjectionEnabled === false ? "false" : "true"
      if (payload.llmEndpoint) envVars["WOPAL_LLM_BASE_URL"] = String(payload.llmEndpoint)
      if (payload.llmModel) envVars["WOPAL_LLM_MODEL"] = String(payload.llmModel)

      // LLM Key: use typed key -> or existing key in file -> or inherit from global env
      if (payload.llmKey) {
        envVars["WOPAL_LLM_API_KEY"] = String(payload.llmKey)
      } else if (!envVars["WOPAL_LLM_API_KEY"] && globalEnvVars["WOPAL_LLM_API_KEY"]) {
        envVars["WOPAL_LLM_API_KEY"] = globalEnvVars["WOPAL_LLM_API_KEY"]
      }

      if (payload.embeddingEndpoint) envVars["WOPAL_EMBEDDING_BASE_URL"] = String(payload.embeddingEndpoint)
      if (payload.embeddingModel) envVars["WOPAL_EMBEDDING_MODEL"] = String(payload.embeddingModel)

      // Embedding Key: use typed key -> or existing key in file -> or reuse llm key -> or inherit from global
      if (payload.embeddingKey) {
        envVars["WOPAL_EMBEDDING_API_KEY"] = String(payload.embeddingKey)
      } else if (payload.reuseEmbedding || !envVars["WOPAL_EMBEDDING_API_KEY"]) {
        const fallbackKey = envVars["WOPAL_LLM_API_KEY"] || globalEnvVars["WOPAL_EMBEDDING_API_KEY"] || globalEnvVars["WOPAL_LLM_API_KEY"]
        if (fallbackKey) {
          envVars["WOPAL_EMBEDDING_API_KEY"] = fallbackKey
        }
      }
    }

    const lines = Object.entries(envVars).map(([k, v]) => `${k}=${v}`)
    writeFileSync(targetEnvPath, lines.join("\n") + "\n", "utf-8")
    return true
  } catch (err) {
    console.error(`[onboarding-ipc] Failed to write memory env file at ${targetEnvPath}:`, err)
    return false
  }
}

export function resolveTargetEnvPath(homePath: string, scope?: string, spacePath?: string): string {
  if (scope === "space") {
    if (spacePath) {
      return join(spacePath, ".wopal", ".env")
    }
    try {
      const detected = detectMemoryConfig(homePath)
      if (detected?.effectiveSpace?.path) {
        return join(detected.effectiveSpace.path, ".wopal", ".env")
      }
    } catch {}
    throw new Error("Space scope configuration requires a valid space path.")
  }
  return join(homePath, ".env")
}

export function buildMemoryOperationInput(input?: unknown, homePath?: string): Record<string, unknown> {
  const payload = (input as Record<string, unknown> | undefined) ?? {}
  const result: Record<string, unknown> = {}

  if (typeof payload.enabled === "boolean") result.enabled = payload.enabled
  if (payload.scope) result.scope = payload.scope
  if (payload.spaceMode) result.spaceMode = payload.spaceMode
  if (typeof payload.memoryInjectionEnabled === "boolean") {
    result.memoryInjectionEnabled = payload.memoryInjectionEnabled
  }

  if (typeof payload.spacePath === "string" && payload.spacePath) {
    result.spacePath = payload.spacePath
  } else if (payload.scope === "space" && homePath) {
    try {
      const detected = detectMemoryConfig(homePath)
      if (detected?.effectiveSpace?.path) {
        result.spacePath = detected.effectiveSpace.path
      }
    } catch {}
  }

  if (payload.skip || payload.enabled === false || payload.spaceMode === "disabled") {
    result.enabled = false
    return result
  }

  if (payload.spaceMode === "inherit") {
    return result
  }

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
  abortSignal?: AbortSignal,
) => Promise<OnboardingStepResult>

export interface OnboardingIpcDeps {
  homePath?: string
  executeStep?: StepExecutor
  broadcastProgress?: (progress: any) => void
  // Persists WOPAL_HOME into the user shell profile. Defaults to a no-op so that
  // tests never rewrite the real user shell profile; production wiring injects
  // the real implementation (see main/ipc.ts).
  persistWopalHomeEnv?: (wopalHome: string) => { success: boolean; message?: string }
}

function noopPersistWopalHomeEnv(_wopalHome: string): { success: boolean; message?: string } {
  return { success: true }
}

const STEP_OPERATION_LABELS: Record<string, string> = {
  "system-check": "检查系统环境",
  "install-cli": "安装与配置基础组件",
  "github-auth": "配置 GitHub 认证",
  "ai-provider": "配置 AI Provider",
  "ontology-setup": "准备能力本体",
  "create-space": "创建或复用工作空间",
  "memory-config": "配置记忆系统",
  "done": "完成空间设置",
}

export function createOnboardingIpcHandlers(deps: OnboardingIpcDeps = {}) {
  let currentOperation: Promise<OnboardingStepResult> | null = null
  let currentAbortController: AbortController | null = null

  const defaultExecuteStep: StepExecutor = async (step, input, onProgress, abortSignal) => {
    const homePath = deps.homePath ?? process.env.WOPAL_HOME ?? join(homedir(), ".wopal")
    process.env.WOPAL_HOME = homePath
    
    const logger = getOnboardingLogger(homePath)
    logger.log(`Executing step: ${step}`)
    
    const isWin = process.platform === "win32"
    const binPath = join(homePath, "bin", isWin ? "wopal.exe" : "wopal")

switch (step as string) {
        case "inspect":
          return normalizeSetupResult(await runSetupOperation({
            binaryPath: binPath,
            operation: "inspect",
            input: {},
            onProgress,
          }))

        case "system-check": {
          const inputHome = (input as Record<string, unknown> | undefined)?.customHomePath as string | undefined
          const targetHome = inputHome?.trim() ? inputHome.trim() : homePath
          const resolvedHome = targetHome.startsWith("~") ? join(homedir(), targetHome.slice(1)) : targetHome
          deps.homePath = resolvedHome
          process.env.WOPAL_HOME = resolvedHome
          ;(deps.persistWopalHomeEnv ?? noopPersistWopalHomeEnv)(resolvedHome)
          return performSystemCheck(resolvedHome)
        }

        case "install-cli": {
          const subStep = (input as Record<string, unknown> | undefined)?.subStep
          if (subStep === "wopal") {
            const res = await installWopalCli({
              homePath,
              forceUpgrade: (input as Record<string, unknown> | undefined)?.forceUpgrade as boolean | undefined,
              onProgress,
              abortSignal,
            })
            const cliProbe = probeLocalCli(binPath)
            if (res.status !== "failed" && cliProbe.version) {
              return {
                ...res,
                result: { ...(res.result ?? {}), version: cliProbe.version },
              }
            }
            return res
          }
          if (subStep === "ellamaka") {
            const payload = { ...((input as Record<string, unknown>) ?? {}) }
            delete payload.homePath
            delete payload.forkUrl
            delete payload.subStep
            if (!payload.requirements || typeof payload.requirements !== "object") {
              payload.requirements = {}
            }
            return normalizeSetupResult(await runSetupOperation({
              binaryPath: binPath,
              operation: "install-engine",
              input: payload,
              onProgress,
              abortSignal,
            }))
          }

          const wopalRes = await installWopalCli({
            homePath,
            forceUpgrade: (input as Record<string, unknown> | undefined)?.forceUpgrade as boolean | undefined,
            onProgress,
            abortSignal,
          })
          if (wopalRes.status === "failed") return wopalRes

          const payload = { ...((input as Record<string, unknown>) ?? {}) }
          delete payload.homePath
          delete payload.forkUrl
          if (!payload.requirements || typeof payload.requirements !== "object") {
            payload.requirements = {}
          }
          const ellamakaRes = normalizeSetupResult(await runSetupOperation({
            binaryPath: binPath,
            operation: "install-engine",
            input: payload,
            onProgress,
            abortSignal,
          }))
          if (ellamakaRes.status === "failed") return ellamakaRes

          return {
            status: "completed",
            result: {
              wopal: wopalRes.result,
              ellamaka: ellamakaRes.result,
            },
          }
        }

        case "install-wopal-cli":
          return installWopalCli({
            homePath,
            forceUpgrade: (input as Record<string, unknown> | undefined)?.forceUpgrade as boolean | undefined,
            onProgress,
            abortSignal,
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
            abortSignal,
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
            abortSignal,
          }))
        }

        case "ai-provider": {
          const payload = (input as Record<string, unknown>) ?? {}
          const providerId = (payload.provider as string) || (payload.providerId as string) || "opencode-go"

          const apiKey = (payload.apiKey as string | undefined)?.trim() || detectProviderAuth(homePath, providerId)

          if (payload.skip || !apiKey) {
            return { status: "skipped" }
          }

          return normalizeSetupResult(await runSetupOperation({
            binaryPath: binPath,
            operation: "configure-provider",
            input: { providerId, apiKey },
            onProgress,
            abortSignal,
          }))
        }

        case "ontology-setup": {
          const payload = (input as Record<string, unknown>) ?? {}
          const mode = (payload.mode as string) === "fork" ? "fork" : "clone"
          const source = payload.source as string | undefined
          const opInput: Record<string, unknown> = { mode }
          if (source) opInput.source = source
          const ontRes = normalizeSetupResult(await runSetupOperation({
            binaryPath: binPath,
            operation: "prepare-ontology",
            input: opInput,
            onProgress,
            abortSignal,
          }))
          if (ontRes.status === "completed" || ontRes.status === "reused") {
            try {
              await runSetupOperation({
                binaryPath: binPath,
                operation: "prepare-runtime",
                input: {},
                onProgress,
                abortSignal,
              })
            } catch {}
          }
          return ontRes
        }

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
            abortSignal,
          }))
        }

        case "memory-config": {
          const isSkip = Boolean((input as Record<string, unknown> | undefined)?.skip)
          if (isSkip) {
            const globalEnvPath = join(homePath, ".env")
            writeMemoryEnvFile(globalEnvPath, { enabled: false }, homePath)

            const memInput = buildMemoryOperationInput(input, homePath)
            const spacePath = typeof memInput.spacePath === "string" ? memInput.spacePath : undefined
            if (spacePath) {
              clearSpaceMemoryEnvFile(join(spacePath, ".wopal", ".env"))
            }

            return {
              status: "completed",
              result: {
                memoryEnabled: false,
                memoryInjectionEnabled: false,
                scope: "global",
                envPath: globalEnvPath,
                state: "disabled",
                outcome: "disabled_all",
              },
            }
          }

          const memInput = buildMemoryOperationInput(input, homePath)
          const isSpaceScope = memInput.scope === "space"
          const spaceMode = (memInput.spaceMode as string) || (isSpaceScope ? "custom" : undefined)
          const spacePath = typeof memInput.spacePath === "string" ? memInput.spacePath : undefined
          const targetEnvPath = resolveTargetEnvPath(homePath, memInput.scope as string, spacePath)

          if (isSpaceScope && spaceMode === "inherit") {
            clearSpaceMemoryEnvFile(targetEnvPath)
          } else {
            writeMemoryEnvFile(targetEnvPath, memInput, homePath)
          }

          // The CLI configure-memory operation owns global configuration only.
          // Space configuration is written directly above and must not invoke it,
          // otherwise an inherited space payload can overwrite the global switch.
          let cliResult: OnboardingStepResult | null = null
          if (!isSpaceScope) {
            try {
              cliResult = normalizeSetupResult(await runSetupOperation({
                binaryPath: binPath,
                operation: "configure-memory",
                input: memInput,
                onProgress,
                abortSignal,
              }))
            } catch {}
          }

          const globalEnvPath = join(homePath, ".env")
          const globalConfig = readEnvConfig(globalEnvPath)
          const isGlobalEnabled = Boolean(globalConfig?.enabled)

          const memoryEnabled = isSpaceScope && spaceMode === "inherit" ? isGlobalEnabled : memInput.enabled !== false

          return {
            status: "completed",
            result: {
              memoryEnabled,
              memoryInjectionEnabled: isSpaceScope && spaceMode === "inherit"
                ? (globalConfig?.memoryInjectionEnabled !== false)
                : (memInput.memoryInjectionEnabled !== false),
              scope: isSpaceScope ? "space" : "global",
              spaceMode: isSpaceScope ? spaceMode : undefined,
              envPath: isSpaceScope && spaceMode === "inherit" ? globalEnvPath : targetEnvPath,
              llmEndpoint: isSpaceScope && spaceMode === "inherit"
                ? (globalConfig?.llmEndpoint ?? "")
                : (memInput.llmEndpoint ?? (cliResult?.result?.llmEndpoint as string | undefined) ?? ""),
              llmModel: isSpaceScope && spaceMode === "inherit"
                ? (globalConfig?.llmModel ?? "")
                : (memInput.llmModel ?? (cliResult?.result?.llmModel as string | undefined) ?? ""),
              embeddingEndpoint: isSpaceScope && spaceMode === "inherit"
                ? (globalConfig?.embeddingEndpoint ?? "")
                : (memInput.embeddingEndpoint ?? (cliResult?.result?.embeddingEndpoint as string | undefined) ?? ""),
              embeddingModel: isSpaceScope && spaceMode === "inherit"
                ? (globalConfig?.embeddingModel ?? "")
                : (memInput.embeddingModel ?? (cliResult?.result?.embeddingModel as string | undefined) ?? ""),
              llmKeyConfigured: isSpaceScope && spaceMode === "inherit"
                ? Boolean(globalConfig?.hasLlmKey)
                : Boolean(memInput.llmKey || cliResult?.result?.llmKeyConfigured),
              embeddingKeyConfigured: isSpaceScope && spaceMode === "inherit"
                ? Boolean(globalConfig?.hasEmbeddingKey)
                : Boolean(memInput.embeddingKey || cliResult?.result?.embeddingKeyConfigured),
              state: memoryEnabled ? "ready" : "disabled",
              outcome: isSpaceScope && spaceMode === "inherit" ? "cleared" : "saved",
            },
          }
        }

        case "done":
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

    "onboarding-set-current-step": async (_event: unknown, step: OnboardingStepName) => {
      if (!ONBOARDING_STEPS.includes(step)) {
        return { status: "error", message: `Invalid step: ${step}` }
      }
      let state = readOnboardingState(deps.homePath) ?? createDefaultOnboardingState()
      state = navigateToStep(state, step)
      writeOnboardingState(state, deps.homePath)
      return { status: "ok", currentStep: state.currentStep }
    },

    "onboarding-probe": async (_event: unknown, kind: string) => {
        const homePath = deps.homePath || process.env.WOPAL_HOME || join(homedir(), ".wopal")
        deps.homePath = homePath
        process.env.WOPAL_HOME = homePath
        const isWin = process.platform === "win32"
        const binPath = join(homePath, "bin", isWin ? "wopal.exe" : "wopal")

        switch (kind) {
          case "home": {
            const homePath = deps.homePath || process.env.WOPAL_HOME || join(homedir(), ".wopal")
            return { homePath, wopalHome: homePath }
          }
          case "ontology-setup":
          case "ontology": {
            const ontologyPath = join(homePath, "ontologies", "wopal-space-ontology")
            const pathExists = existsSync(ontologyPath)
            const executor = deps.executeStep ?? defaultExecuteStep
            const inspection = await executor("inspect")
            if (inspection.status === "failed") {
              return {
                status: "broken",
                ontologyInstalled: false,
                ontologyMode: null,
                ontologyPath,
                availableTypes: [],
                error: inspection.error?.message ?? "无法检查空间能力本体。",
              }
            }
            const inspectionError = typeof inspection.result?.error === "string"
              ? inspection.result.error
              : null
            if (inspectionError) {
              return {
                status: "broken",
                ontologyInstalled: false,
                ontologyMode: null,
                ontologyPath,
                availableTypes: [],
                error: inspectionError,
              }
            }
            const reportedInstalled = Boolean(inspection.result?.ontologyInstalled)
            const rawMode = inspection.result?.ontologyMode
            const ontologyMode = rawMode === "fork" || rawMode === "clone" ? rawMode : null
            const ontologyInstalled = reportedInstalled && ontologyMode !== null
            const status = ontologyInstalled ? "ready" : pathExists || reportedInstalled ? "broken" : "missing"
            return {
              status,
              ontologyInstalled,
              ontologyMode,
              ontologyPath,
              availableTypes: Array.isArray(inspection.result?.availableTypes)
                ? inspection.result.availableTypes
                : [],
              error: status === "broken" ? "检测到本体目录，但它不是可复用的有效 Git 仓库。" : undefined,
            }
          }
          case "wopal-cli":
            return probeLocalCli(join(homePath, "bin", isWin ? "wopal.exe" : "wopal"))
          case "ellamaka-cli":
            return probeLocalCli(join(homePath, "bin", isWin ? "ellamaka.exe" : "ellamaka"))
          case "github-auth": {
            return await probeGithubAuthentication(homePath)
          }
          case "ai-provider": {
            const existingKey = detectProviderAuth(homePath, "opencode-go")
            return {
              hasKey: !!existingKey,
              maskedKey: existingKey ? `${existingKey.slice(0, 3)}...${existingKey.slice(-4)}` : null,
            }
          }
          case "runtime": {
            try {
              const ontologyDir = join(homePath, "ontologies", "wopal-space-ontology")
              const agentsDir = join(homePath, "agents")
              const skillsDir = join(homePath, "skills")
              const rulesDir = join(homePath, "rules")

              const hasOntology = existsSync(ontologyDir)
              const hasCapabilities = existsSync(agentsDir) || existsSync(skillsDir) || existsSync(rulesDir)

              if (hasOntology && hasCapabilities) {
                return {
                  ready: true,
                  homePath,
                  config: { missingKeys: [] },
                  scripts: { missing: [], stale: [] },
                  capabilities: { missing: [], empty: [], stale: [] },
                }
              }

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
              const binPath = join(homePath, "bin", isWin ? "wopal.exe" : "wopal")
              const ontologyDir = join(homePath, "ontologies", "wopal-space-ontology")
              const gitDir = join(ontologyDir, ".git")
              const installed = existsSync(gitDir) || existsSync(ontologyDir)

              if (installed) {
                const availableTypes: Array<{ type: string; branch: string }> = [{ type: "common", branch: "main" }]
                try {
                  const typeHeadsDir = join(gitDir, "refs", "heads", "type")
                  if (existsSync(typeHeadsDir)) {
                    const entries = readdirSync(typeHeadsDir)
                    for (const entry of entries) {
                      if (entry && !entry.startsWith(".")) {
                        availableTypes.push({ type: entry, branch: `type/${entry}` })
                      }
                    }
                  }
                } catch {}

                const spaces = probeWopalSpaceList(binPath, { WOPAL_HOME: homePath })

                let ontologyMode: "fork" | "clone" = "clone"
                try {
                  const configPath = join(gitDir, "config")
                  if (existsSync(configPath)) {
                    const configText = readFileSync(configPath, "utf-8")
                    if (configText.includes("upstream") || configText.includes("fork")) {
                      ontologyMode = "fork"
                    }
                  }
                } catch {}

                return {
                  availableTypes,
                  spaces,
                  ontologyInstalled: true,
                  ontologyMode,
                  homePath,
                  wopalHome: homePath,
                  defaultSpacePath: join(homedir(), "WopalSpace"),
                  legacyContract: false,
                }
              }

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
                wopalHome: homePath,
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
                wopalHome: homePath,
                defaultSpacePath: join(homedir(), "WopalSpace"),
                error: err instanceof Error ? err.message : String(err),
                errorCode: "ENVIRONMENT_INSPECT_FAILED",
              }
            }
          }
          case "memory": {
            try {
              const detected = detectMemoryConfig(homePath)
              if (detected) {
                return detected
              }
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
              const spaces = Array.isArray(res.result?.spaces) ? res.result.spaces : []
              const effectiveSpace = memory.effectiveSpace ?? spaces[0] ?? null
              return effectiveSpace ? { ...memory, effectiveSpace } : memory
            } catch (err) {
              return {
                state: "unconfigured",
                enabled: false,
                envPath: join(homePath, ".env"),
                error: err instanceof Error ? err.message : String(err),
              }
            }
          }
          case "system-user": {
            let appVersion: string | undefined
            try {
              appVersion = getReleaseInfo().displayVersion
            } catch {}
            return { userName: resolveSystemUserName(), appVersion }
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
        return {
          status: "failed",
          error: {
            code: "ONBOARDING_OPERATION_BUSY",
            message: "另一个安装或配置任务仍在运行，请等待当前任务结束后再重试。",
          },
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

        const abortController = new AbortController()
        currentAbortController = abortController

        try {
          const executor = deps.executeStep ?? defaultExecuteStep
          const res = await executor(stepName, input, (p) => deps.broadcastProgress?.({ step: stepName, ...p }), abortController.signal)

          state = readOnboardingState(deps.homePath) ?? state
          if (res.status === "completed" || res.status === "reused") {
            state = updateStep(state, stepName, "done")
          } else if (res.status === "skipped") {
            state = updateStep(state, stepName, "skipped")
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
          currentAbortController = null
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
      const homePath = deps.homePath ?? process.env.WOPAL_HOME ?? join(homedir(), ".wopal")
      if (!writeOnboardingState(state, homePath)) {
        return {
          status: "failed" as const,
          error: {
            code: "ONBOARDING_STATE_WRITE_FAILED",
            message: "Runtime is healthy, but the onboarding completion state could not be saved.",
          },
        }
      }
      // Persist WOPAL_HOME to user environment variables / shell profile
      ;(deps.persistWopalHomeEnv ?? noopPersistWopalHomeEnv)(homePath)
      return { status: "completed" as const, result: readiness.result }
    },

    "onboarding-cancel-step": async () => {
      if (currentAbortController) {
        currentAbortController.abort()
        return { status: "ok" }
      }
      return { status: "no-op" }
    },

    "onboarding-set-wopal-home": async (_event: unknown, newHomePath: string) => {
      if (typeof newHomePath === "string" && newHomePath.trim().length > 0) {
        const trimmed = newHomePath.trim()
        // Reject path traversal attacks or raw dangerous inputs
        if (trimmed.includes("\0") || trimmed.includes("..")) {
          return { status: "error", message: "Invalid or unsafe home path" }
        }
        const resolved = trimmed.startsWith("~") ? join(homedir(), trimmed.slice(1)) : trimmed
        deps.homePath = resolved
        process.env.WOPAL_HOME = resolved
        return { status: "ok", homePath: resolved }
      }
      return { status: "error", message: "Invalid home path" }
    },
  }
}
