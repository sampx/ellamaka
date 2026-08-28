import { drizzle } from "drizzle-orm/node-sqlite/driver"
import * as http from "node:http"
import * as tls from "node:tls"
import { register, createRequire } from "node:module"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { pathToFileURL } from "node:url"

if (typeof register === "function") {
  const loaderCode = `
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".js") && (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("file://"))) {
    const parentURL = context.parentURL;
    if (parentURL && (parentURL.includes("/plugins/") || parentURL.includes("/skills/") || parentURL.includes("packages/ellamaka-cordis"))) {
      let candidateURL = specifier.startsWith("file://") ? specifier : new URL(specifier, parentURL).href;
      const candidatePath = fileURLToPath(candidateURL);
      if (!existsSync(candidatePath)) {
        const tsPath = candidatePath.slice(0, -3) + ".ts";
        if (existsSync(tsPath)) {
          // Pass the .ts URL to nextResolve so Node.js native --experimental-strip-types applies correctly!
          return nextResolve(pathToFileURL(tsPath).href, context);
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
`;
  register(`data:text/javascript;base64,${Buffer.from(loaderCode).toString("base64")}`, import.meta.url)
}

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
}

type StopCommand = { type: "stop" }
type SetLogLevelCommand = { type: "setLogLevel"; level: "DEBUG" | "INFO" | "WARN" | "ERROR" }
type SidecarCommand = StartCommand | StopCommand | SetLogLevelCommand

type SidecarMessage =
  | { type: "sqlite"; progress: { type: "InProgress"; value: number } | { type: "Done" } }
  | { type: "ready"; dshPort?: number }
  | { type: "stopped" }
  | { type: "error"; error: { message: string; stack?: string } }

type ParentPort = {
  postMessage(message: SidecarMessage): void
  on(event: "message", listener: (event: { data: unknown }) => void): void
}

type Listener = {
  stop(close?: boolean): void | Promise<void>
}

const parentPort = getParentPort()
let listener: Listener | undefined
let dshHost: { dispose(): Promise<void> } | undefined
let dshToolsHost: { dispose(): Promise<void> } | undefined

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
    // Optional dsh web engine (single-process dual-port, PoC §7.14).
    // The dsh closure lives at $DSH_HOME (default $WOPAL_HOME/ellamaka/data/dsh),
    // materialised by onboarding `npm install` (scheme B). The sidecar mounts it
    // onto a process-level cordis hub bound to a random loopback port. When the
    // closure is absent (not yet installed), dsh is skipped and the sidecar runs
    // normally — the same kill-switch semantics as ELLAMAKA_DSH=0.
    const dshPort = await mountDshIfPresent()
    // The tool container (ellamaka-tools profile) feeds the dsh-adapter so
    // Workbench sessions can adopt container tools. It has no webserver; the
    // container is exposed through globalThis like the CLI serve path.
    await mountDshToolsIfPresent()
    parentPort.postMessage({ type: "ready", dshPort })
  } catch (error) {
    parentPort.postMessage({ type: "error", error: serializeError(error) })
    setImmediate(() => process.exit(1))
  }
}

/**
 * Mount the dsh web engine when its closure is present under $DSH_HOME.
 *
 * Resolves the closure home as `$DSH_HOME` (fallback `$WOPAL_HOME/ellamaka/data/dsh`).
 * If the `@deepseek-ai/dsh` package is not materialised there yet, returns
 * `undefined` and the sidecar continues without dsh. A successful mount returns
 * the bound dsh port for the ready message; the host handle is retained for
 * clean unmount on stop.
 */
async function mountDshIfPresent(): Promise<number | undefined> {
  const dshHome =
    process.env.DSH_HOME ?? join(process.env.WOPAL_HOME ?? join(homedir(), ".wopal"), "ellamaka", "data", "dsh")
  const anchor = join(dshHome, "node_modules", "@deepseek-ai", "dsh", "package.json")
  if (!existsSync(anchor)) {
    // Closure not materialised yet — skip dsh without error (onboarding not done).
    return undefined
  }
  // Resolve @wopal/ellamaka-cordis/dsh-web from the closure's node_modules
  // (it is a dependency of the materialised closure). The sidecar bundle
  // itself does not carry dsh or cordis, so we anchor resolution at the
  // closure. bootDshWeb is self-contained (creates its own cordis context),
  // which sidesteps the @wopal/ellamaka-cordis index import chain that Node
  // strip-types cannot resolve.
  const requireFromClosure = createRequire(join(dshHome, "package.json"))
  const dshWebEntry = requireFromClosure.resolve("@wopal/ellamaka-cordis/dsh-web")
  const { bootDshWeb } = await import(pathToFileURL(dshWebEntry).href)
  const wopalHome = process.env.WOPAL_HOME ?? join(homedir(), ".wopal")
  const host = await bootDshWeb({
    home: dshHome,
    port: 0,
    installAnchor: anchor,
    logFile: join(wopalHome, "logs", "dsh-plugins.log"),
  })
  dshHost = { dispose: () => host.dispose() }
  return host.port
}

/**
 * Mount the dsh tool container (ellamaka-tools profile) when the dsh closure
 * is present, and expose it via `globalThis.__ellamakaDshContainer` so the
 * dsh-adapter plugin can project container tools into ellamaka's ToolRegistry.
 * The tool container has no webserver — it is a pure tool backend for
 * Workbench sessions. Absent closure skips silently (adapter degrades to no
 * projected tools; ellamaka builtins keep serving).
 */
async function mountDshToolsIfPresent(): Promise<void> {
  const dshHome =
    process.env.DSH_HOME ?? join(process.env.WOPAL_HOME ?? join(homedir(), ".wopal"), "ellamaka", "data", "dsh")
  const anchor = join(dshHome, "node_modules", "@deepseek-ai", "dsh", "package.json")
  if (!existsSync(anchor)) {
    return undefined
  }
  const requireFromClosure = createRequire(join(dshHome, "package.json"))
  const dshWebEntry = requireFromClosure.resolve("@wopal/ellamaka-cordis/dsh-web")
  const { bootDshTools } = await import(pathToFileURL(dshWebEntry).href)
  const wopalHome = process.env.WOPAL_HOME ?? join(homedir(), ".wopal")
  const host = await bootDshTools({
    home: dshHome,
    port: 0,
    installAnchor: anchor,
    logFile: join(wopalHome, "logs", "dsh-plugins.log"),
  })
  dshToolsHost = { dispose: () => host.dispose() }
  ;(globalThis as Record<string, unknown>).__ellamakaDshContainer = host.ctx
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
