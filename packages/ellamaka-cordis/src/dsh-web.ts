/**
 * Mount the dsh web engine onto an existing cordis context (single container).
 *
 * The host replays the dsh `boot()` sequence on the caller's context instead
 * of creating a second container: the web profile (dsh-base + dsh-web-app)
 * mounts through the cordis Loader with its NATIVE webserver bound to a
 * second loopback port. The port is chosen by the caller (explicit, or `0`
 * for an OS-assigned port). dsh source is untouched and community plugins
 * keep working — the web UI and its `/api` requests resolve against their
 * own origin.
 *
 * @module @wopal/ellamaka-cordis/dsh-web
 */
import {
  assertEntriesActivated,
  healProfilesModuleFallback,
  loadProfile,
  mountRootInclude,
} from "@deepseek-ai/dsh-app-boot"
import { provideCmdline } from "@deepseek-ai/dsh-cmdline"
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from "@deepseek-ai/dsh-launch-environment"
import { dshHomePath } from "@deepseek-ai/dsh-home-paths"
import Loader from "@deepseek-ai/cordis-plugin-loader"
import type { Context } from "@deepseek-ai/cordis"
import { dirname, join } from "node:path"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { createCordisLogExporter, type EllamakaLogLevel } from "./log-bridge.js"

/** The bundled web profile: dsh-base + dsh-web-app. */
const PROFILE_NAME = "web"

const require = createRequire(import.meta.url)

/**
 * Shipped agent-preset root, beside the `@deepseek-ai/dsh` install anchor's
 * own config (`config/agent-presets/`). Carries the built-in `standard` preset
 * (and friends) the web UI defaults to. Mirrors how the dsh CLI's
 * `composeProfile` assembles the SHIPPED root — `loadProfile` alone does not.
 */
const SHIPPED_PRESET_ROOT = join(
  dirname(require.resolve("@deepseek-ai/dsh/package.json")),
  "config",
  "agent-presets",
)

/** A handle to a mounted dsh engine. */
export interface DshHost {
  /** The port the dsh native webserver bound. */
  readonly port: number
  /** The URL of the dsh web UI. */
  readonly url: string
  /** Unmount the dsh plugin tree; the host context stays alive. */
  dispose(): Promise<void>
}

export interface DshHostOptions {
  /** The dsh home directory (`$DSH_HOME`). Defaults to the user's `~/.dsh`. */
  home?: string
  /** The loopback port for the dsh webserver; `0` asks the OS for a free one. */
  port: number
  /**
   * Explicit path to the `@deepseek-ai/dsh` package.json acting as the
   * installation anchor. When omitted, `require.resolve` locates it from
   * this host package's closure. Desktop packaged mode passes the
   * materialised closure copy under `$DSH_HOME` because `require.resolve`
   * cannot reach it from the bundled sidecar.
   */
  installAnchor?: string
  /**
   * Optional prepare hook run before the plugin tree mounts. Receives the
   * host context so callers can provide extra services dsh plugins need.
   */
  prepare?: (ctx: Context) => Promise<void> | void
  /**
   * Optional path to a dedicated dsh-plugins log file. When set, a cordis
   * log Exporter is registered on the host context so every dsh plugin's
   * `ctx.logger` output lands in this file (independent of the ellamaka main
   * log and of the Plan-1 cordis-plugins.log). When omitted, dsh plugin logs
   * fall through to the default cordis console exporter.
   */
  logFile?: string
  /** Minimum log level for the dsh-plugins log; defaults to DEBUG. */
  logLevel?: EllamakaLogLevel
}

/**
 * Mount the dsh web engine onto an existing cordis context.
 *
 * Replays the dsh `boot()` sequence (baseUrl, dshHomePath, Loader, prepare,
 * root include, activation audit) on the caller's context — one process, one
 * container. The dsh webserver binds a second loopback port.
 *
 * @param ctx - the host cordis context (e.g. a CordisHub's ctx).
 * @param options - home, port, and optional prepare hook.
 * @returns a {@link DshHost} handle.
 */
export async function mountDshWeb(ctx: Context, opts: DshHostOptions): Promise<DshHost> {
  const { home, port, prepare, logFile, logLevel } = opts
  // The dsh installation anchor: resolve the @deepseek-ai/dsh package.json
  // from this host package so loadProfile finds the bundle layers in the
  // host's node_modules closure. Desktop packaged mode overrides it to the
  // materialised closure copy under $DSH_HOME because require.resolve cannot
  // reach the resource directory from the bundled sidecar.
  const installAnchor = opts.installAnchor ?? require.resolve("@deepseek-ai/dsh/package.json")

  // Register the dsh-plugins log Exporter before any plugin mounts, so every
  // dsh plugin's ctx.logger output lands in the dedicated file. The Exporter
  // is auto-disposed with the host fiber (zero manual cleanup).
  if (logFile) {
    const exporter = createCordisLogExporter({
      logFile,
      minLevel: logLevel ?? "DEBUG",
      write: (line) => {
        try {
          appendFileSync(logFile, line, "utf-8")
        } catch {
          try {
            mkdirSync(dirname(logFile), { recursive: true })
            appendFileSync(logFile, line, "utf-8")
          } catch {
            // log write failures must never break the dsh mount
          }
        }
      },
    })
    ctx.logger.exporter(exporter)
  }

  // Link the profiles/node_modules fallback in the (possibly temp) home so the
  // profile's plugin rows resolve against this installation's dependency
  // closure (matches how the dsh launcher boots a profile).
  healProfilesModuleFallback(installAnchor, home)

  // Load the web profile (dsh-base + dsh-web-app bundle layers).
  const profile = loadProfile("ellamaka", PROFILE_NAME, installAnchor, home)
  // Compose the effective patch list: bundle layers + profile layer.
  const patches = [
    ...profile.layers.flatMap((layer) => layer.patches),
    ...profile.patches,
    // Assemble the SHIPPED agent-preset root (`standard` etc.) the same way
    // the dsh CLI's composeProfile does — loadProfile alone does not inject
    // it, so without this the roster is empty and sessions cannot start.
    { id: "agent-presets", config: { default: "standard", roots: [{ path: SHIPPED_PRESET_ROOT, trust: "system" }] } },
    // code-runtime depends on node:module.stripTypeScriptTypes (Node 22.18+),
    // which the bun dev runtime lacks. It is a code-execution capability, not
    // part of the web UI chat surface, so disable it to boot under bun.
    { id: "code-runtime", disabled: true },
  ]
  const rootConfig = join(profile.dir, "cordis.yml")
  // The root config is the host-owned include: an empty entry list. The
  // bundle + profile patch layers carry every plugin.
  writeFileSync(rootConfig, "[]\n")

  // Replay the dsh boot() sequence on the host context (single container).
  ctx.baseUrl = pathToFileURL(dirname(rootConfig)).href + "/"
  ctx.provide("dshHomePath", dshHomePath)
  const loaderFiber = await ctx.registry.plugin(Loader)
  // Intrinsic host setup: the launch environment snapshot and the cmdline
  // service (--port) that the web-startup plugin reads to bind the webserver.
  ctx.provide(
    DSH_LAUNCH_ENVIRONMENT_KEY,
    createLaunchEnvironmentSnapshot([{ source: "process", values: process.env as Record<string, string> }]),
  )
  provideCmdline(ctx, { args: ["--port", String(port)], exit: () => {} })
  await prepare?.(ctx)
  const includeEntry = await mountRootInclude(ctx, rootConfig, patches)
  await ctx.get("loader")?.await()
  if (ctx.get("loader") === undefined || includeEntry === undefined) {
    throw new Error("ellamaka-cordis: dsh boot did not provide a loader service")
  }
  await assertEntriesActivated(ctx, "ellamaka")

  const webServer = ctx.get("webServer")
  if (webServer === undefined) {
    throw new Error("ellamaka-cordis: dsh boot did not provide a webServer service")
  }
  const boundPort = webServer.port
  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}`,
    dispose: async () => {
      const loader = ctx.get("loader")
      if (loader !== undefined) await loader.remove(includeEntry.id)
      await loaderFiber.dispose()
    },
  }
}

/**
 * Boot the dsh web engine on a fresh context (standalone use, tests).
 *
 * Convenience wrapper around {@link mountDshWeb} that owns the container:
 * dispose tears the whole context down.
 */
export async function bootDshWeb(opts: DshHostOptions): Promise<DshHost> {
  const { Context } = await import("@deepseek-ai/cordis")
  const ctx = new Context()
  const host = await mountDshWeb(ctx, opts)
  return {
    port: host.port,
    url: host.url,
    dispose: async () => {
      await host.dispose()
      await ctx.fiber.dispose()
    },
  }
}
