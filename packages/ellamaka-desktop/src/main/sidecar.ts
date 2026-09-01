import { drizzle } from "drizzle-orm/node-sqlite/driver"
import * as http from "node:http"
import * as tls from "node:tls"
import { register } from "node:module"
import { join } from "node:path"
import { homedir } from "node:os"

register(new URL("./source-ts-loader.js", import.meta.url), import.meta.url)

type NodeHttpWithEnvProxy = typeof http & {
  setGlobalProxyFromEnv: () => void
}

type NodeTlsWithSystemCertificates = typeof tls & {
  getCACertificates: (type: "default" | "system") => string[]
  setDefaultCACertificates: (certificates: string[]) => void
}

type StartCommand = {
  type: "start"
  hostname: string
  port: number
  password: string
  needsMigration: boolean
  /** The wopal home the dsh runtime manager resolves closures under. */
  wopalHome?: string
  /** Path to the dedicated dsh-plugins log file. */
  logFile?: string
}

type StopCommand = { type: "stop" }
type SetLogLevelCommand = { type: "setLogLevel"; level: "DEBUG" | "INFO" | "WARN" | "ERROR" }
type SidecarCommand = StartCommand | StopCommand | SetLogLevelCommand

type SidecarMessage =
  | { type: "sqlite"; progress: { type: "InProgress"; value: number } | { type: "Done" } }
  | { type: "ready" }
  | { type: "stopped" }
  | { type: "error"; error: { message: string; stack?: string } }

type ParentPort = {
  postMessage(message: SidecarMessage): void
  on(event: "message", listener: (event: { data: unknown }) => void): void
}

type Listener = {
  port: number
  stop(close?: boolean): void | Promise<void>
  mountNodeRoute(mount: {
    prefix: string
    request(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void
    upgrade?(req: import("node:http").IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void
  }): () => void
}

const parentPort = getParentPort()
let listener: Listener | undefined
let dshHost: { dispose(): Promise<void> } | undefined
let dshToolsHost: { dispose(): Promise<void> } | undefined

/**
 * The dsh runtime initialised once per launch (W-02). The manager's
 * per-process in-flight cache alone is not enough: two sequential manager
 * calls can each start a fresh run when the first FAILED (in-flight is
 * removed on settle), so reusing the first run's outcome here guarantees the
 * sidecar initialises the dsh runtime exactly once and both the web and tool
 * mounts share the same status/anchor/runtime.
 */
let dshLaunchState: {
  status: import("virtual:opencode-server").DshRuntimeStatus
  anchor?: import("virtual:opencode-server").DshInstallAnchor
  runtime?: import("virtual:opencode-server").DshRuntimeApi
} | undefined

parentPort.on("message", (event) => {
  const command = parseCommand(event.data)
  if (!command) return
  if (command.type === "stop") {
    void stop()
    return
  }
  if (command.type === "setLogLevel") {
    void setLogLevel(command.level)
    return
  }
  void start(command)
})

async function start(command: StartCommand) {
  try {
    prepareSidecarEnv(command.password)
    ensureLoopbackNoProxy()
    useSystemCertificates()
    useEnvProxy()
    const { Database, JsonMigration, Log, Server } = await import("virtual:opencode-server")
    // Desktop dev.sh 通过 ELAMAKA_DESKTOP_* 环境变量控制日志行为：
    //   ELAMAKA_DESKTOP_DEV=1             → dev 模式（写到 WOPAL_DEBUG_LOG_DIR/ellamaka-dev-sidecar.log）
    //   ELAMAKA_DESKTOP_LOG_LEVEL=<LEVEL> → 日志级别（默认 WARN，向后兼容）
    // 未设置时（打包发布版 / 普通用户）走默认行为，与历史一致。
    const sidecarDev = process.env.ELAMAKA_DESKTOP_DEV === "1"
    const sidecarLogLevel = (process.env.ELAMAKA_DESKTOP_LOG_LEVEL ?? "WARN") as
      | "DEBUG"
      | "INFO"
      | "WARN"
      | "ERROR"
    await Log.init({ level: sidecarLogLevel, dev: sidecarDev, devFile: "ellamaka-dev-sidecar.log", role: "sidecar" })

    if (command.needsMigration) {
      await JsonMigration.run(drizzle({ client: Database.Client().$client }), {
        progress: (event: { current: number; total: number }) => {
          parentPort.postMessage({
            type: "sqlite",
            progress: {
              type: "InProgress",
              value: event.total === 0 ? 100 : Math.round((event.current / event.total) * 100),
            },
          })
        },
      })
      parentPort.postMessage({ type: "sqlite", progress: { type: "Done" } })
    }

    listener = await Server.listen({
      port: command.port,
      hostname: command.hostname,
      username: "ellamaka",
      password: command.password,
      cors: ["oc://renderer"],
    })
    // Optional dsh engine (single-process, DESIGN-dsh-poc §2.1/§3.4). The
    // unified Runtime Manager (consumed via `virtual:opencode-server`, which
    // the opencode sidecar bundle exports) gates on `ELLAMAKA_DSH` itself
    // (`=0` → disabled with zero file access) and materialises the closure on
    // demand; `disabled`/`degraded` never block the sidecar — the server runs
    // untouched. The web VirtualWebServer mounts onto the Ellamaka listener
    // under /dsh; the tool container (ellamaka-tools profile) feeds the
    // dsh-adapter so Workbench sessions can adopt container tools. A single
    // initialisation per launch is shared by both mounts (W-02); each mount is
    // wrapped in a degrade boundary so a broken closure never exits the
    // sidecar (B-06).
    await mountDshIfPresent(command)
    await mountDshToolsIfPresent(command)
    parentPort.postMessage({ type: "ready" })
  } catch (error) {
    parentPort.postMessage({ type: "error", error: serializeError(error) })
    setImmediate(() => process.exit(1))
  }
}

/** Resolve the wopal home and dsh-plugins log file for this launch. */
function dshLaunch(command: StartCommand) {
  const wopalHome = command.wopalHome ?? process.env.WOPAL_HOME ?? join(homedir(), ".wopal")
  const logFile = command.logFile ?? join(wopalHome, "logs", "dsh-plugins.log")
  return { wopalHome, logFile, home: join(wopalHome, "dsh") }
}

/**
 * Mount the dsh web engine via the unified Runtime Manager.
 *
 * Initialises the dsh runtime exactly once per launch (W-02) and reuses the
 * outcome for both the web and tool mounts. Only on `ready` does it resolve
 * the install anchor, load the closure runtime and mount the VirtualWebServer
 * onto the Ellamaka listener under `/dsh`. `disabled`/`degraded` return
 * without mounting (no warn: the manager already logged the structured
 * diagnosis). A broken closure degrades instead of crashing the sidecar
 * (B-06).
 */
async function mountDshIfPresent(command: StartCommand): Promise<void> {
  const { wopalHome, logFile, home } = dshLaunch(command)
  const { bootDshWeb } = await import("virtual:opencode-server")
  try {
    const launch = await initDshLaunch(command)
    if (launch.status !== "ready" || !launch.anchor || !launch.runtime) return
    const runtime = launch.runtime
    const host = await bootDshWeb({
      home,
      port: listener?.port ?? 0,
      installAnchor: launch.anchor.path,
      logFile,
      runtime,
    })
    // Mount the VirtualWebServer under /dsh on the Ellamaka listener.
    const unmount = listener?.mountNodeRoute({
      prefix: host.mountPath,
      request: (req, res) => host.webServer.request(req, res),
      upgrade: (req, socket, head) => host.webServer.upgrade(req, socket, head),
    })
    dshHost = {
      dispose: async () => {
        unmount?.()
        await host.dispose()
      },
    }
  } catch (error) {
    // A broken closure must never exit the sidecar (B-06).
    console.error(`dsh web mount failed: ${(error as Error).message}`)
  }
}

/**
 * Mount the dsh tool container (ellamaka-tools profile) via the unified
 * Runtime Manager, and expose it via `globalThis.__ellamakaDshContainer` so
 * the dsh-adapter plugin can project container tools into ellamaka's
 * ToolRegistry. Same manager call as the web engine (single-flight, and this
 * launch's shared init result), only mounting on `ready`. `disabled`/`degraded`
 * skip silently; the adapter degrades to no projected tools and ellamaka
 * builtins keep serving.
 */
async function mountDshToolsIfPresent(command: StartCommand): Promise<void> {
  const { logFile, home } = dshLaunch(command)
  const { bootDshTools } = await import("virtual:opencode-server")
  try {
    const launch = await initDshLaunch(command)
    if (launch.status !== "ready" || !launch.anchor || !launch.runtime) return
    const runtime = launch.runtime
    const host = await bootDshTools({
      home,
      port: 0,
      installAnchor: launch.anchor.path,
      logFile,
      runtime,
    })
    dshToolsHost = { dispose: () => host.dispose() }
    ;(globalThis as Record<string, unknown>).__ellamakaDshContainer = host.ctx
  } catch (error) {
    // A broken closure must never exit the sidecar (B-06).
    console.error(`dsh tool container mount failed: ${(error as Error).message}`)
  }
}

/**
 * Initialise the dsh runtime exactly once per launch and cache the outcome
 * (W-02). The manager's per-process in-flight cache covers concurrent calls in
 * one process, but after a FAILED run the in-flight entry is removed, so two
 * sequential manager calls from the web + tool mounts would each re-run the
 * state machine. Caching here makes the web and tool mounts share one status /
 * anchor / runtime.
 */
async function initDshLaunch(command: StartCommand): Promise<NonNullable<typeof dshLaunchState>> {
  if (dshLaunchState) return dshLaunchState
  const { wopalHome, logFile } = dshLaunch(command)
  const { DEFAULT_DSH_RUNTIME_MANIFEST, initializeDshRuntime, resolveInstallAnchor, createDshRuntimeApi } =
    await import("virtual:opencode-server")
  const manifest = DEFAULT_DSH_RUNTIME_MANIFEST
  const status = await initializeDshRuntime({ wopalHome, logFile, entry: "tui", manifest })
  if (status !== "ready") {
    dshLaunchState = { status }
    return dshLaunchState
  }
  const anchor = resolveInstallAnchor(wopalHome, manifest)
  const runtime = createDshRuntimeApi(anchor.path)
  dshLaunchState = { status, anchor, runtime }
  return dshLaunchState
}

async function stop() {
  try {
    delete (globalThis as Record<string, unknown>).__ellamakaDshContainer
    await dshToolsHost?.dispose()
    dshToolsHost = undefined
    await dshHost?.dispose()
    dshHost = undefined
    await listener?.stop()
  } finally {
    listener = undefined
    parentPort.postMessage({ type: "stopped" })
    setImmediate(() => process.exit(0))
  }
}

async function setLogLevel(level: "DEBUG" | "INFO" | "WARN" | "ERROR") {
  const { Log } = await import("virtual:opencode-server")
  Log.setLevel(level)
}

function prepareSidecarEnv(password: string) {
  Object.assign(process.env, {
    OPENCODE_SERVER_USERNAME: "ellamaka",
    OPENCODE_SERVER_PASSWORD: password,
  })
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

function useSystemCertificates() {
  try {
    const nodeTls = tls as NodeTlsWithSystemCertificates
    nodeTls.setDefaultCACertificates([
      ...new Set([...nodeTls.getCACertificates("default"), ...nodeTls.getCACertificates("system")]),
    ])
  } catch (error) {
    console.warn("failed to load system certificates", error)
  }
}

function useEnvProxy() {
  try {
    ;(http as NodeHttpWithEnvProxy).setGlobalProxyFromEnv()
  } catch (error) {
    console.warn("failed to load proxy environment", error)
  }
}

function parseCommand(value: unknown): SidecarCommand | undefined {
  if (!value || typeof value !== "object") return
  const command = value as Partial<StartCommand | StopCommand | SetLogLevelCommand>
  if (command.type === "stop") return { type: "stop" }
  if (command.type === "setLogLevel") {
    if (command.level === "DEBUG" || command.level === "INFO" || command.level === "WARN" || command.level === "ERROR") {
      return { type: "setLogLevel", level: command.level }
    }
    return
  }
  if (command.type !== "start") return
  if (typeof command.hostname !== "string") return
  if (typeof command.port !== "number") return
  if (typeof command.password !== "string") return
  if (typeof command.needsMigration !== "boolean") return
  return {
    type: "start",
    hostname: command.hostname,
    port: command.port,
    password: command.password,
    needsMigration: command.needsMigration,
    wopalHome: typeof command.wopalHome === "string" ? command.wopalHome : undefined,
    logFile: typeof command.logFile === "string" ? command.logFile : undefined,
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function getParentPort() {
  const port = process.parentPort as ParentPort | undefined
  if (!port) throw new Error("Sidecar parent port unavailable")
  return port
}
