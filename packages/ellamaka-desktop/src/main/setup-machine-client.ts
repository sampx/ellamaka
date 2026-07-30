import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import semver from "semver"
import type { OnboardingStepResult } from "../preload/types"
import { terminateChildProcessTree } from "./child-process-lifecycle"

export interface RunSetupOperationOptions {
  binaryPath: string
  operation: string
  input?: Record<string, unknown>
  onProgress?: (progress: { phase?: string; message?: string }) => void
  timeoutMs?: number
  inactivityTimeoutMs?: number
  abortSignal?: AbortSignal
  spawnFn?: (command: string, args: string[], options: any) => ChildProcess
}

export function extractJsonEnvelope(stdout: string, stderr: string): any | null {
  const combined = stdout + "\n" + stderr
  // Clean ANSI escape codes
  const clean = combined.replace(/\u001b\[[0-9;]*[mGK]/g, "")
  const jsonMatches = clean.match(/\{[\s\S]*"ok"\s*:\s*(true|false)[\s\S]*\}/g)
  if (jsonMatches) {
    for (let i = jsonMatches.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(jsonMatches[i])
        if (parsed && typeof parsed.ok === "boolean") return parsed
      } catch {}
    }
  }
  return null
}

function sanitizeDiagnosticText(value: string, maxLength = 2000): string {
  return value
    .replace(/\u001b\[[0-9;]*[mGK]/g, "")
    .replace(/(?:gh[pousr]_[a-zA-Z0-9]{20,}|sk-[a-zA-Z0-9_-]{16,})/g, "***")
    .trim()
    .slice(-maxLength)
}

function buildOperationDetails(input: {
  operation: string
  command: string
  args: string[]
  exitCode: number | null
  stderr?: string
  stdout?: string
  upstreamDetails?: string
}): string {
  const lines = [
    `Operation: ${input.operation}`,
    `Command: ${input.command} ${input.args.join(" ")}`,
    `Exit code: ${input.exitCode ?? "unknown"}`,
  ]
  const upstreamDetails = sanitizeDiagnosticText(input.upstreamDetails ?? "")
  const stderr = sanitizeDiagnosticText(input.stderr ?? "")
  const stdout = sanitizeDiagnosticText(input.stdout ?? "")
  if (upstreamDetails) lines.push(`Details: ${upstreamDetails}`)
  if (stderr) lines.push(`Stderr: ${stderr}`)
  if (stdout) lines.push(`Stdout: ${stdout}`)
  return lines.join("\n")
}

export function resolveWopalCliEntry(binaryPath: string): { command: string; spawnArgs: string[] } | null {
  // In development, prefer local source over downloaded binary
  if (process.env.WOPAL_DEV_CLI_PATH && existsSync(process.env.WOPAL_DEV_CLI_PATH)) {
    if (process.env.WOPAL_DEV_CLI_PATH.endsWith(".ts")) {
      return { command: "bun", spawnArgs: [process.env.WOPAL_DEV_CLI_PATH, "setup", "--machine", "--json", "--api-version", "1"] }
    }
  }

  if (existsSync(binaryPath)) {
    return { command: binaryPath, spawnArgs: ["setup", "--machine", "--json", "--api-version", "1"] }
  }

  return null
}

export async function runSetupOperation(options: RunSetupOperationOptions): Promise<OnboardingStepResult> {
  const { binaryPath, operation, input = {}, onProgress, spawnFn, abortSignal } = options
  const timeoutMs = options.timeoutMs ?? (
    operation === "install-engine" ? 600000 : operation === "prepare-ontology" ? 300000 : 120000
  )
  const inactivityTimeoutMs = options.inactivityTimeoutMs ?? (operation === "install-engine" ? 45000 : 0)

  const resolved = resolveWopalCliEntry(binaryPath)
  if (!resolved && !spawnFn) {
    return {
      status: "failed",
      error: {
        code: "WOPAL_BINARY_NOT_FOUND",
        message: `Wopal CLI entry/binary not found at ${binaryPath}. Please verify installation.`,
      },
    }
  }

  const command = resolved?.command ?? binaryPath
  const spawnArgs = resolved?.spawnArgs ?? ["setup", "--machine", "--json", "--api-version", "1"]

  if (!spawnFn) {
    try {
      const versionResult = spawnSync(command, ["--version"])
      if (versionResult.stdout) {
        const actual = versionResult.stdout.toString().trim().replace(/^v/, "")
        const minVersion = process.env.MIN_WOPAL_CLI_VERSION || "0.3.4"
        const normalizedActual = semver.valid(actual) || semver.valid(semver.coerce(actual)?.version || "")
        const normalizedMin = semver.valid(minVersion) || semver.valid(semver.coerce(minVersion)?.version || "")

        if (normalizedActual && normalizedMin && semver.lt(normalizedActual, normalizedMin)) {
          return {
            status: "failed",
            error: {
              code: "WOPAL_CLI_INCOMPATIBLE",
              message: `Wopal CLI version too low (${actual}). Minimum required is ${minVersion}.`,
            },
          }
        }
      }
    } catch (e) {
      // Ignore version check errors
    }
  }

  const payload = JSON.stringify({ operation, ...input })
  const spawnImpl = spawnFn ?? spawn

  const env = {
    ...process.env,
    ...(input.homePath ? { WOPAL_HOME: String(input.homePath) } : {}),
  }

  return new Promise((resolve) => {
    let stdoutData = ""
    let stderrData = ""
    let isSettled = false
    let child: ChildProcess
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      clearTimeout(timer)
      if (inactivityTimer) clearTimeout(inactivityTimer)
      abortSignal?.removeEventListener("abort", abortHandler)
    }

    const stop = async (result: OnboardingStepResult) => {
      if (isSettled) return
      isSettled = true
      cleanup()
      await terminateChildProcessTree(child)
      resolve(result)
    }

    const resetInactivityTimer = () => {
      if (inactivityTimeoutMs <= 0) return
      if (inactivityTimer) clearTimeout(inactivityTimer)
      inactivityTimer = setTimeout(() => {
        void stop({
          status: "failed",
          error: {
            code: "ENGINE_DOWNLOAD_STALLED",
            message: "Ellamaka AI 引擎下载长时间无响应，已停止本次安装。",
            suggestion: "请检查网络连接或代理设置，确认网络恢复后点击下方“重试安装”。",
            details: `Operation '${operation}' produced no output for ${inactivityTimeoutMs}ms.`,
          },
        })
      }, inactivityTimeoutMs)
    }

    const abortHandler = () => {
      void stop({
        status: "failed",
        error: {
          code: "SETUP_OPERATION_ABORTED",
          message: `Operation '${operation}' was aborted.`,
        },
      })
    }

    const timer = setTimeout(() => {
      void stop({
        status: "failed",
        error: operation === "install-engine"
          ? {
              code: "ENGINE_INSTALL_TIMEOUT",
              message: "Ellamaka AI 引擎安装超时，已停止本次安装。",
              suggestion: "请检查网络连接或代理设置，确认网络恢复后点击下方“重试安装”。",
              details: `Operation '${operation}' timed out after ${timeoutMs}ms.`,
            }
          : {
              code: "SETUP_OPERATION_TIMEOUT",
              message: `Operation '${operation}' timed out after ${timeoutMs}ms.`,
            },
      })
    }, timeoutMs)

    try {
      child = spawnImpl(command, spawnArgs, {
        env,
        stdio: "pipe",
        detached: process.platform !== "win32",
      })
    } catch (err) {
      clearTimeout(timer)
      return resolve({
        status: "failed",
        error: {
          code: "SETUP_SPAWN_ERROR",
          message: `Failed to spawn setup process: ${err instanceof Error ? err.message : String(err)}`,
        },
      })
    }

    if (abortSignal) {
      if (abortSignal.aborted) {
        abortHandler()
        return
      }
      abortSignal.addEventListener("abort", abortHandler)
    }

    resetInactivityTimer()

    child.stdout?.on("data", (chunk: any) => {
      if (isSettled) return
      resetInactivityTimer()
      const str = chunk.toString()
      stdoutData += str
      // Forward non-JSON progress lines to onProgress.
      // The JSON envelope is a single multi-line object written at the end;
      // progress lines (e.g. "  ellamaka v1.2.3", "  Downloading...") are
      // plain text and won't interfere with envelope extraction.
      const lines = str.split("\n")
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("}")) {
          onProgress?.({ phase: operation, message: trimmed })
        }
      }
    })

    child.stderr?.on("data", (chunk: any) => {
      if (isSettled) return
      resetInactivityTimer()
      const str = chunk.toString()
      stderrData += str
      onProgress?.({ phase: operation, message: str.trim() })
    })

    child.stdin?.write(payload)
    child.stdin?.end()

    child.on("exit", (code) => {
      if (isSettled) return
      isSettled = true
      cleanup()

      const envelope = extractJsonEnvelope(stdoutData, stderrData)
      if (envelope && typeof envelope === "object") {
        // Validate capability contract
        if (envelope.capability !== "setup.operation") {
          return resolve({
            status: "failed",
            error: {
              code: "SETUP_RESPONSE_INVALID",
              message: `Unexpected capability '${envelope.capability}' in response. Expected 'setup.operation'.`,
            },
          })
        }

        if (envelope.ok === true && envelope.data) {
          // Validate operation matches and result is an object
          if (envelope.data.operation !== operation) {
            return resolve({
              status: "failed",
              error: {
                code: "SETUP_RESPONSE_INVALID",
                message: `Response operation '${envelope.data.operation}' does not match requested '${operation}'.`,
              },
            })
          }
          if (!envelope.data.result || typeof envelope.data.result !== "object") {
            return resolve({
              status: "failed",
              error: {
                code: "SETUP_RESPONSE_INVALID",
                message: "Response data.result is missing or not an object.",
              },
            })
          }

          // Map CLI status to Desktop status:
          //   created → completed, reused → reused, skipped → skipped
          const cliStatus = envelope.data.status as string
          const desktopStatus = cliStatus === "created" ? "completed"
            : cliStatus === "reused" ? "reused"
            : cliStatus === "skipped" ? "skipped"
            : "__invalid__"

          if (desktopStatus === "__invalid__") {
            return resolve({
              status: "failed",
              error: {
                code: "SETUP_RESPONSE_INVALID",
                message: `Unknown CLI status '${cliStatus}' in response.`,
              },
            })
          }

          // Business result is envelope.data.result (not envelope.data)
          return resolve({
            status: desktopStatus as OnboardingStepResult["status"],
            result: (envelope.data.result ?? {}) as Record<string, unknown>,
          })
        }
        if (envelope.ok === false && envelope.error) {
          const upstreamDetails = typeof envelope.error.details === "string"
            ? envelope.error.details
            : undefined
          return resolve({
            status: "failed",
            error: {
              code: envelope.error.code ?? "SETUP_OPERATION_FAILED",
              message: envelope.error.message ?? "Operation failed",
              suggestion: typeof envelope.error.suggestion === "string"
                ? envelope.error.suggestion
                : undefined,
              details: buildOperationDetails({
                operation,
                command,
                args: spawnArgs,
                exitCode: code,
                stderr: stderrData,
                upstreamDetails,
              }),
            },
          })
        }
      }

      resolve({
        status: "failed",
        error: {
          code: "SETUP_RESPONSE_INVALID",
          message: `Setup machine operation '${operation}' returned invalid output or exit code ${code}.`,
          details: buildOperationDetails({
            operation,
            command,
            args: spawnArgs,
            exitCode: code,
            stderr: stderrData,
            stdout: stdoutData,
          }),
        },
      })
    })

    child.on("error", (err: Error) => {
      if (isSettled) return
      isSettled = true
      cleanup()
      resolve({
        status: "failed",
        error: {
          code: "SETUP_PROCESS_ERROR",
          message: `Setup process encountered error: ${err.message}`,
        },
      })
    })
  })
}
