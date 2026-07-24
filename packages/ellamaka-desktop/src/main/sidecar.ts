import { drizzle } from "drizzle-orm/node-sqlite/driver"
import * as http from "node:http"
import * as tls from "node:tls"
import { register } from "node:module"

if (typeof register === "function") {
  const loaderCode = `
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".js") && (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("file://"))) {
    const parentURL = context.parentURL;
    if (parentURL && (parentURL.includes("/plugins/") || parentURL.includes("/skills/"))) {
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
  | { type: "ready" }
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
    parentPort.postMessage({ type: "ready" })
  } catch (error) {
    parentPort.postMessage({ type: "error", error: serializeError(error) })
    setImmediate(() => process.exit(1))
  }
}

async function stop() {
  try {
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
