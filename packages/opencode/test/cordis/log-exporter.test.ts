import { describe, expect, test } from "bun:test"
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { Effect, Layer, ManagedRuntime } from "effect"
import { TurnDriver } from "@/session/turn-driver"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import {
  createTurnDriverLayer,
  cordisHubLayer,
  CordisHubService,
  createCordisLogExporter,
} from "@wopal/ellamaka-cordis"
import { createCordisPluginAssembly, cordisPluginsLogFile } from "@/server/cordis-mount"

describe("cordis log exporter", () => {
  test("cordisPluginsLogFile resolves to the space logs dir for a wopal-space directory", () => {
    const spaceRoot = mkdtempSync(path.join(tmpdir(), "cordis-space-"))
    mkdirSync(path.join(spaceRoot, ".wopal"), { recursive: true })
    writeFileSync(path.join(spaceRoot, ".wopal", ".git"), "gitdir: ./.git\n")
    const instanceDir = path.join(spaceRoot, "projects", "demo")
    mkdirSync(instanceDir, { recursive: true })

    const logFile = cordisPluginsLogFile(instanceDir)
    expect(logFile).toBe(path.join(spaceRoot, ".wopal-space", "logs", "cordis-plugins.log"))
  })

  test("cordisPluginsLogFile resolves to WOPAL_HOME logs for a non-space directory", () => {
    const plainDir = mkdtempSync(path.join(tmpdir(), "cordis-plain-"))

    const logFile = cordisPluginsLogFile(plainDir)
    expect(logFile).toBe(path.join(Global.Path.log, "cordis-plugins.log"))
  })

  test("createCordisLogExporter writes to the target file and respects level", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "cordis-log-"))
    const logFile = path.join(tmpDir, "cordis-plugins.log")
    const lines: string[] = []
    const exporter = createCordisLogExporter({
      logFile,
      minLevel: "WARN",
      write: (line) => lines.push(line),
    })
    // cordis Message shape
    const msg = (type: "error" | "warn" | "info" | "debug", name: string) => ({
      sn: 1,
      ts: Date.now(),
      name,
      type,
      level: type === "error" ? 0 : type === "info" ? 1 : type === "warn" ? 2 : 3,
      args: ["hello %s", "world"],
    })
    exporter.export(msg("error", "hub") as never)
    exporter.export(msg("warn", "spill-policy") as never)
    exporter.export(msg("info", "grep-bridge") as never)
    exporter.export(msg("debug", "spill-local") as never)

    // minLevel=WARN: error and warn pass, info and debug dropped
    expect(lines.length).toBe(2)
    expect(lines[0]).toContain("[ERROR] [hub]")
    expect(lines[1]).toContain("[WARN] [spill-policy]")
  })

  test("hub created/disposing logs reach cordis-plugins.log, not the main log", async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "cordis-hub-"))
    const cordisLogFile = path.join(tmpDir, "cordis-plugins.log")

    const assembly = createCordisPluginAssembly({
      logFile: cordisLogFile,
      logLevel: "DEBUG",
    })

    const built = Layer.mergeAll(
      createTurnDriverLayer(TurnDriver.Service, { directory: Effect.succeed("/test/log") }).pipe(
        Layer.provide(assembly.hubs),
      ),
      assembly.hubs,
    )

    const rt = ManagedRuntime.make(built)
    try {
      // force hub creation
      await rt.runPromise(
        Effect.gen(function* () {
          const registry = yield* CordisHubService
          const hub = yield* registry.forDirectory("/test/log").pipe(Effect.scoped)
          // hub "created" is logged by the assembly after Exporter registration;
          // emit a plugin-style log to verify it reaches the file
          hub.ctx.logger.info("test-event")
        }),
      )
    } finally {
      await rt.dispose()
    }

    // give async file writes a moment
    await new Promise((r) => setTimeout(r, 100))

    // cordis-plugins.log should contain hub created + test-event + disposing
    expect(existsSync(cordisLogFile)).toBe(true)
    const cordisContent = readFileSync(cordisLogFile, "utf-8")
    expect(cordisContent).toContain("[cordis-hub]")
    expect(cordisContent).toContain("created")
    expect(cordisContent).toContain("disposing")
    expect(cordisContent).toContain("test-event")

    // main log should NOT contain cordis plugin logs
    const mainLogPath = Log.file()
    if (existsSync(mainLogPath)) {
      const mainContent = readFileSync(mainLogPath, "utf-8")
      expect(mainContent).not.toContain("[cordis-hub]")
      expect(mainContent).not.toContain("[spill-policy]")
    }
  })
})