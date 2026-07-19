const MODES = ["coverage", "auth", "effect"] as const
const DEFAULT_MODE_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_KILL_GRACE_MS = 2 * 1000

type Mode = (typeof MODES)[number]
type ShutdownSignal = "SIGINT" | "SIGTERM" | "SIGHUP"
type Subprocess = ReturnType<typeof Bun.spawn>

const packageDirectory = `${import.meta.dir}/..`
const extraArgs = Bun.argv.slice(2)
const modeTimeoutMs = readMilliseconds("OPENCODE_HTTPAPI_MODE_TIMEOUT_MS", DEFAULT_MODE_TIMEOUT_MS)
const killGraceMs = readMilliseconds("OPENCODE_HTTPAPI_KILL_GRACE_MS", DEFAULT_KILL_GRACE_MS)

let activeSubprocess: Subprocess | undefined
let shutdownPromise: Promise<void> | undefined

function readMilliseconds(name: string, fallback: number) {
  const value = process.env[name]
  if (value === undefined) return fallback

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number of milliseconds`)
  }
  return parsed
}

function signalSubprocess(subprocess: Subprocess, signal: "SIGTERM" | "SIGKILL") {
  if (process.platform !== "win32") {
    try {
      // Each mode is detached, so its pid is also the process-group id.
      process.kill(-subprocess.pid, signal)
      return
    } catch {
      // The process group may have exited between the check and the signal.
    }
  }

  try {
    subprocess.kill(signal)
  } catch {
    // Cleanup is best effort when the child already exited.
  }
}

async function stopSubprocess(subprocess: Subprocess) {
  const exited = subprocess.exited
  signalSubprocess(subprocess, "SIGTERM")

  await Promise.race([
    exited.then(() => true),
    Bun.sleep(killGraceMs).then(() => false),
  ])
  // The leader can exit while a descendant keeps the process group alive.
  signalSubprocess(subprocess, "SIGKILL")
  await exited
}

async function runMode(mode: Mode) {
  const subprocess = Bun.spawn(
    [
      process.execPath,
      "script/httpapi-exercise.ts",
      "--mode",
      mode,
      "--fail-on-missing",
      "--fail-on-skip",
      ...extraArgs,
    ],
    {
      cwd: packageDirectory,
      env: process.env,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      detached: true,
      // The explicit watchdog below kills the whole group. Keep Bun's native
      // timeout as a backstop if the runner itself is delayed.
      timeout: modeTimeoutMs + killGraceMs,
    },
  )
  activeSubprocess = subprocess

  let timedOut = false
  let timeoutCleanup: Promise<void> | undefined
  const timer = setTimeout(() => {
    timedOut = true
    console.error(`[httpapi] ${mode} exceeded ${modeTimeoutMs}ms; terminating its process group`)
    timeoutCleanup = stopSubprocess(subprocess)
  }, modeTimeoutMs)

  try {
    const exitCode = await subprocess.exited
    if (timeoutCleanup) await timeoutCleanup
    if (timedOut) throw new Error(`${mode} mode timed out after ${modeTimeoutMs}ms`)
    return exitCode
  } finally {
    clearTimeout(timer)
    // Also clean up descendants when the mode exits with a non-zero code.
    signalSubprocess(subprocess, "SIGKILL")
    if (activeSubprocess === subprocess) activeSubprocess = undefined
  }
}

async function shutdown(signal: ShutdownSignal) {
  if (shutdownPromise) return shutdownPromise

  shutdownPromise = (async () => {
    if (activeSubprocess) await stopSubprocess(activeSubprocess)
    process.exit(128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 })[signal])
  })()
  return shutdownPromise
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => void shutdown(signal))
}

try {
  for (const mode of MODES) {
    console.log(`[httpapi] running ${mode} mode (timeout ${modeTimeoutMs}ms)`)
    const exitCode = await runMode(mode)
    if (exitCode !== 0) {
      process.exitCode = exitCode ?? 1
      break
    }
  }
} catch (error) {
  console.error(`[httpapi] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (activeSubprocess) await stopSubprocess(activeSubprocess)
}
