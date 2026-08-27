/**
 * Mount a dsh profile onto an existing cordis context (single container).
 *
 * The host replays the dsh `boot()` sequence on the caller's context instead
 * of creating a second container. Two entry points share one core:
 *
 * - {@link mountDshWeb} loads the `web` profile (dsh-base + dsh-web-app) and
 *   binds the dsh NATIVE webserver to a second loopback port — the surface
 *   the Workbench iframe embeds. The port is chosen by the caller (explicit,
 *   or `0` for an OS-assigned port).
 * - {@link mountDshTools} loads the `ellamaka-tools` profile (dsh-base with
 *   the agent-loop-only plugins disabled) with NO webserver — the pure tool
 *   backend the dsh-adapter drives with a lightweight per-call context.
 *
 * dsh source is untouched and community plugins keep working.
 *
 * @module @wopal/ellamaka-cordis/dsh-web
 */
import {
  assertEntriesActivated,
  healProfilesModuleFallback,
  initProfile,
  loadProfile,
  mountRootInclude,
  resolveProfileDir,
  DEFAULT_PROFILE_BUNDLES,
  PROFILE_PATCH_FILENAME,
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
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { createCordisLogExporter, type EllamakaLogLevel } from "./log-bridge.js"

/** The bundled web profile: dsh-base + dsh-web-app. */
const WEB_PROFILE_NAME = "web"
/** The tool-container profile: dsh-base with agent-loop plugins disabled. */
const TOOLS_PROFILE_NAME = "ellamaka-tools"

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

/**
 * Default patch layer for the `ellamaka-tools` profile. Written on first
 * mount (never afterwards — user edits win), so the disable list lives in the
 * user-owned profile file, not in code.
 *
 * The tool container is a pure tool backend: the dsh-adapter drives its
 * tools with a lightweight per-call context (no live dsh sessions, no agent
 * loops). Every row below is agent-loop infrastructure — it needs live
 * sessions or serves the dsh chat surface — and is disabled so the container
 * stays session-free and its tool surface stays clean. Re-enable a row only
 * when adopting the corresponding capability together with its full runtime
 * context.
 */
const TOOLS_PROFILE_PATCH = `# Patch layer for the ellamaka tool-container profile.
#
# The tool container is a pure tool backend: the dsh-adapter drives its tools
# with a lightweight per-call context (no live dsh sessions, no agent loops).
# Every row below is agent-loop infrastructure — it needs live sessions or
# serves the dsh chat surface — and is disabled so the container stays
# session-free and its tool surface stays clean. Re-enable a row only when
# adopting the corresponding capability together with its full runtime
# context.

# --- session & agent-loop core ---
# Session lifecycle belongs to ellamaka; the container must stay session-free.
- { id: session, disabled: true }
# Flushes the calling agent's live session before every tool call; the
# adapter's per-call context has no live session, so this would throw.
- { id: session-checkpoint-policy, disabled: true }
- { id: agent, disabled: true }
- { id: agent-loop, disabled: true }
- { id: agent-default-model, disabled: true }
- { id: agent-instructions, disabled: true }

# --- session persistence / query / projection / telemetry ---
- { id: session-title, disabled: true }
- { id: session-title-llm, disabled: true }
- { id: session-persistence-jsonl, disabled: true }
- { id: session-query-sqlite, disabled: true }
- { id: session-projection, disabled: true }
- { id: session-telemetry-otel, disabled: true }

# --- llm runtime & credentials (no model calls in the tool container) ---
- { id: llm, disabled: true }
- { id: llm-retry, disabled: true }
- { id: llm-deepseek, disabled: true }
- { id: llm-pi-ai, disabled: true }
- { id: settings, disabled: true }
- { id: credentials, disabled: true }

# --- api gateway (typert) ---
- { id: typert, disabled: true }
- { id: typert-loader, disabled: true }
- { id: typert-gateway, disabled: true }

# --- interactive surface (questions, approval, permission presets) ---
- { id: user-questions, disabled: true }
- { id: approval, disabled: true }
- { id: permission, disabled: true }

# --- subagent delegation (agent-loop stack; ellamaka has native subagents) ---
- { id: subagent, disabled: true }
- { id: subagent-spawn-in-process, disabled: true }
- { id: subagent-fork-in-process, disabled: true }
- { id: tool-subagent, disabled: true }
- { id: tool-subagent-fork, disabled: true }
- { id: tool-subagent-control, disabled: true }
- { id: tool-subagent-report, disabled: true }
- { id: tool-subagent-list-agents, disabled: true }
- { id: workflow-worker-thread, disabled: true }
- { id: tool-workflow, disabled: true }
- { id: tool-ralph, disabled: true }

# --- background jobs ---
- { id: jobs, disabled: true }
- { id: tool-jobs, disabled: true }

# --- goals / plan mode / commands / skills ---
- { id: goal, disabled: true }
- { id: goal-round-driver, disabled: true }
- { id: tool-goal, disabled: true }
- { id: command-goal, disabled: true }
- { id: plan-mode, disabled: true }
- { id: commands, disabled: true }
- { id: command-feedback, disabled: true }
- { id: command-compact, disabled: true }
- { id: skill, disabled: true }
- { id: skill-filesystem, disabled: true }
- { id: tool-skill, disabled: true }

# --- compaction / token accounting ---
- { id: compaction-basic, disabled: true }
- { id: token-meter, disabled: true }
- { id: tool-result-pruner, disabled: true }

# --- web search (needs llm + credentials) ---
- { id: web, disabled: true }
- { id: web-search-deepseek, disabled: true }
- { id: tool-web, disabled: true }

# --- attachments / todo / reminders (agent-loop UX) ---
- { id: attachment-local, disabled: true }
- { id: tool-todo, disabled: true }
- { id: repeat-tool-reminder, disabled: true }
`

/** A handle to a mounted dsh engine. */
export interface DshHost {
  /** The port the dsh native webserver bound; absent when no webserver mounts. */
  readonly port?: number
  /** The URL of the dsh web UI; absent when no webserver mounts. */
  readonly url?: string
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
   * log). When omitted, dsh plugin logs fall through to the default cordis
   * console exporter.
   */
  logFile?: string
  /** Minimum log level for the dsh-plugins log; defaults to DEBUG. */
  logLevel?: EllamakaLogLevel
  /**
   * Optional extra patch rows applied after the profile layers. Used by
   * callers to disable profile entries that only serve the dsh agent loop
   * (e.g. session-checkpoint-policy) when the container is driven as a
   * tool backend rather than a full dsh session host.
   */
  extraPatches?: Record<string, unknown>[]
}

/** Internal mount options shared by the web and base entry points. */
type MountProfileOptions = DshHostOptions & {
  profileName: string
  /** Extra patch rows applied after the profile layers. */
  extraPatches: Record<string, unknown>[]
  /** Whether the mounted profile must provide a webserver service. */
  requireWebServer: boolean
}

/**
 * Mount a dsh profile onto an existing cordis context.
 *
 * Replays the dsh `boot()` sequence (baseUrl, dshHomePath, Loader, prepare,
 * root include, activation audit) on the caller's context — one process, one
 * container. When `requireWebServer` is set, the dsh webserver must bind and
 * its port is returned; otherwise no webserver is expected.
 *
 * @param ctx - the host cordis context (e.g. a CordisHub's ctx).
 * @param options - profile name, home, port, extra patches, and whether a
 *   webserver is required.
 * @returns a {@link DshHost} handle.
 */
async function mountProfile(ctx: Context, opts: MountProfileOptions): Promise<DshHost> {
  const { home, port, prepare, logFile, logLevel, profileName, extraPatches, requireWebServer } = opts
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

  // The tool-container profile seeds its default patch layer (disable the
  // agent-loop-only plugins) on first mount. The file is user-owned: once the
  // user edits it (anything beyond initProfile's empty template), it is never
  // overwritten.
  if (profileName === TOOLS_PROFILE_NAME) {
    const dir = resolveProfileDir(profileName, home)
    initProfile(dir, DEFAULT_PROFILE_BUNDLES)
    const patchPath = join(dir, PROFILE_PATCH_FILENAME)
    try {
      const current = readFileSync(patchPath, "utf-8")
      const stripped = current
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"))
        .join("\n")
        .trim()
      if (stripped === "[]") {
        writeFileSync(patchPath, TOOLS_PROFILE_PATCH)
      }
    } catch {
      writeFileSync(patchPath, TOOLS_PROFILE_PATCH)
    }
  }

  // Load the profile (bundle layers + user patch layer).
  const profile = loadProfile("ellamaka", profileName, installAnchor, home)
  // Compose the effective patch list: bundle layers + profile layer + extras.
  const patches = [
    ...profile.layers.flatMap((layer) => layer.patches),
    ...profile.patches,
    ...extraPatches,
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

  const dispose = async () => {
    const loader = ctx.get("loader")
    if (loader !== undefined) await loader.remove(includeEntry.id)
    await loaderFiber.dispose()
  }

  if (!requireWebServer) {
    return { dispose }
  }

  const webServer = ctx.get("webServer")
  if (webServer === undefined) {
    throw new Error("ellamaka-cordis: dsh boot did not provide a webServer service")
  }
  const boundPort = webServer.port
  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}`,
    dispose,
  }
}

/**
 * Mount the dsh web engine onto an existing cordis context.
 *
 * Loads the `web` profile (dsh-base + dsh-web-app) and binds the dsh
 * webserver to a second loopback port.
 *
 * @param ctx - the host cordis context (e.g. a CordisHub's ctx).
 * @param options - home, port, and optional prepare hook.
 * @returns a {@link DshHost} handle.
 */
export async function mountDshWeb(ctx: Context, opts: DshHostOptions): Promise<DshHost> {
  return mountProfile(ctx, {
    ...opts,
    profileName: WEB_PROFILE_NAME,
    requireWebServer: true,
    extraPatches: [
      // Assemble the SHIPPED agent-preset root (`standard` etc.) the same way
      // the dsh CLI's composeProfile does — loadProfile alone does not inject
      // it, so without this the roster is empty and sessions cannot start.
      { id: "agent-presets", config: { default: "standard", roots: [{ path: SHIPPED_PRESET_ROOT, trust: "system" }] } },
      // code-runtime depends on node:module.stripTypeScriptTypes (Node 22.18+),
      // which the bun dev runtime lacks. It is a code-execution capability, not
      // part of the web UI chat surface, so disable it to boot under bun.
      { id: "code-runtime", disabled: true },
      ...(opts.extraPatches ?? []),
    ],
  })
}

/**
 * Mount the tool-container profile onto an existing cordis context.
 *
 * A dedicated dsh profile for ellamaka's direct tool adoption: same
 * {@link mountProfile} boot sequence, but the entry list comes from the
 * `ellamaka-tools` profile (dsh-base bundles) whose user-owned patch layer
 * disables the agent-loop-only plugins. Tools execute with a lightweight
 * per-call context — no live dsh sessions, no checkpoint flush.
 *
 * @param ctx - the host cordis context.
 * @param options - home, port, and optional prepare hook.
 * @returns a {@link DshHost} handle.
 */
export async function mountDshTools(ctx: Context, opts: DshHostOptions): Promise<DshHost> {
  return mountProfile(ctx, {
    ...opts,
    profileName: TOOLS_PROFILE_NAME,
    requireWebServer: false,
    extraPatches: [
      // HMR needs --expose-internals (bun lacks it); the tool surface has no
      // hot-reload need, so disable it to boot under bun.
      { id: "hmr", disabled: true },
      { id: "tool-bash", config: { enableRunInBackground: false } },
      ...(opts.extraPatches ?? []),
    ],
  })
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

/**
 * Boot the ellamaka-tools profile on a fresh context (standalone use,
 * desktop sidecar).
 *
 * Convenience wrapper around {@link mountDshTools} that owns the container.
 * The context itself is returned in the handle so the caller can expose it
 * (e.g. `globalThis.__ellamakaDshContainer`) — the tool container has no
 * webserver, its services reach the adapter through direct object access.
 */
export interface DshToolsHost extends DshHost {
  /** The cordis context backing the tool container. */
  readonly ctx: Context
}

export async function bootDshTools(opts: DshHostOptions): Promise<DshToolsHost> {
  const { Context } = await import("@deepseek-ai/cordis")
  const ctx = new Context()
  const host = await mountDshTools(ctx, opts)
  return {
    port: host.port,
    url: host.url,
    ctx,
    dispose: async () => {
      await host.dispose()
      await ctx.fiber.dispose()
    },
  }
}
