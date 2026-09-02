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
import type { Context } from "@deepseek-ai/cordis"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { createCordisLogExporter, type EllamakaLogLevel } from "./log-bridge.js"
import { VirtualWebServer, DSH_MOUNT_PREFIX } from "./dsh-virtual-webserver.js"
import {
  createClosureRequire,
  createPackageDshRuntimeApi,
  type DshRuntimeApi,
} from "./runtime/loader.js"

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
 *
 * Resolved lazily from the given install anchor (or, when omitted, this
 * module's own closure): the root must track the anchor the mount actually
 * resolves the dsh packages from — a bundled host (packaged CLI, Desktop
 * sidecar) passes the materialised closure copy under `$WOPAL_HOME/dsh`
 * (DESIGN-dsh-poc §2.2), and a module-load-time constant would silently
 * point at the wrong closure or crash the whole module on resolve.
 */
export function shippedPresetRoot(installAnchor?: string): string {
  const anchor = installAnchor ?? require.resolve("@deepseek-ai/dsh/package.json")
  return join(dirname(anchor), "config", "agent-presets")
}

/**
 * Default patch layer for the `ellamaka-tools` profile. Written on first
 * mount (never afterwards — user edits win), so the disable list lives in the
 * user-owned profile file, not in code.
 *
 * The tool container is a pure tool backend: the dsh-adapter drives its tools
 * with a lightweight per-call context (no live dsh sessions, no agent loops).
 * The rows below are agent-loop infrastructure — they need live sessions or
 * serve the dsh chat surface — and are disabled so the container stays
 * session-free and its tool surface stays clean. Re-enable a row only when
 * adopting the corresponding capability together with its full runtime
 * context.
 *
 * `approval` is intentionally NOT disabled: dsh's sandbox escalation
 * (`sandbox_permissions`) resolves its one-shot approval through the native
 * ApprovalService. The adapter's per-call facade satisfies the plugin's
 * runtime preconditions (open turn via turn/start..turn/end, appendable
 * events for the approval/asked + approval/decided audit pair), and the
 * adapter registers the `approval/request` answerer that bridges the ask to
 * ellamaka Permission. An absent answerer still fails closed
 * (`unavailable`), and a `never` escalation policy rejects in-service.
 */
const TOOLS_PROFILE_PATCH = `# Patch layer for the ellamaka tool-container profile.
#
# The tool container is a pure tool backend: the dsh-adapter drives its tools
# with a lightweight per-call context (no live dsh sessions, no agent loops).
# The rows below are agent-loop infrastructure — they need live sessions or
# serve the dsh chat surface — and are disabled so the container stays
# session-free and its tool surface stays clean. Re-enable a row only when
# adopting the corresponding capability together with its full runtime
# context.
#
# \`approval\` is intentionally NOT disabled: dsh's sandbox escalation
# (\`sandbox_permissions\`) resolves its one-shot approval through the native
# ApprovalService. The adapter's per-call facade satisfies the plugin's
# runtime preconditions (open turn via turn/start..turn/end, appendable
# events for the approval/asked + approval/decided audit pair), and the
# adapter registers the \`approval/request\` answerer that bridges the ask to
# ellamaka Permission. An absent answerer still fails closed
# (\`unavailable\`), and a \`never\` escalation policy rejects in-service.

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

# --- interactive surface (questions, permission presets) ---
# 'approval' is ENABLED (not listed below): dsh's native escalation
# choreography (approveEscalation) resolves 'sandbox_permissions' asks
# through it. The per-call facade carries the open turn
# (turn/start..turn/end from the adapter) and the audit-pair sink
# (session.append), and the host bridges 'approval/request' to ellamaka
# Permission — a rejected/missing answerer fails closed.
- { id: user-questions, disabled: true }
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

/** A handle to a virtually-mounted dsh web engine. */
export interface DshWebHost {
  /** The mount path under which the DSH surface is served on the Ellamaka listener. */
  readonly mountPath: "/dsh"
  /** The VirtualWebServer the official web profile registered its routes on. */
  readonly webServer: VirtualWebServer
  /** Unmount the dsh plugin tree; the host context stays alive. */
  dispose(): Promise<void>
}

export interface DshHostOptions {
  /** The dsh home directory (`$WOPAL_HOME/dsh`). */
  home?: string
  /** The loopback port for the dsh webserver; `0` asks the OS for a free one. */
  port: number
  /**
   * Explicit path to the `@deepseek-ai/dsh` package.json acting as the
   * installation anchor. When omitted, `require.resolve` locates it from
   * this host package's closure. Desktop packaged mode passes the
   * materialised closure copy under `$WOPAL_HOME/dsh` because `require.resolve`
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
  /**
   * Disable the `code-runtime` plugin. It depends on
   * `node:module.stripTypeScriptTypes` (Node 22.18+), which the bun dev
   * runtime lacks — so the CLI serve path (bun) must disable it. The Desktop
   * sidecar runs under Node 22.18+ and should keep it enabled. Defaults to
   * `false` (enabled).
   */
  disableCodeRuntime?: boolean
  /**
   * The resolved DSH runtime module handle, loaded via
   * `@wopal/ellamaka-cordis/runtime` from the materialised closure
   * (DESIGN-dsh-poc §3.4.6). When omitted, the module falls back to the
   * package closure (source/dev mode) — keeping existing callers unchanged.
   */
  runtime?: DshRuntimeApi
}

/** Internal mount options shared by the web and base entry points. */
type MountProfileOptions = DshHostOptions & {
  profileName: string
  /** Extra patch rows applied after the profile layers. */
  extraPatches: Record<string, unknown>[]
  /** Whether the mounted profile must provide a webserver service. */
  requireWebServer: boolean
  /** When set, provide this VirtualWebServer instead of binding a real socket. */
  virtualWebServer?: VirtualWebServer
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
  const { home, port, prepare, logFile, logLevel, profileName, extraPatches, requireWebServer, virtualWebServer } = opts
  // The DSH runtime module handle: preferred from an injected runtime. The
  // package-closure fallback below is a DEV-ONLY seam (B-01) — every production
  // mount call site (CLI serve/web, TUI, Desktop sidecar) injects the
  // closure-resolved runtime via `DshHostOptions.runtime`; packaged hosts ship
  // without `@deepseek-ai/*` in their own closure and MUST never reach this
  // fallback.
  const runtime = opts.runtime ?? createPackageDshRuntimeApi()
  // dsh runtime isolation (DESIGN-dsh-poc §3.4): every dsh engine runtime byte
  // (settings/sessions/storages/credentials/.../home-patch) lands under
  // `$WOPAL_HOME/dsh/state`, NOT `~/.dsh`. Done via pure config injection —
  // zero env, never `process.env.DSH_HOME`. When the caller omits `home`, fall
  // back to the standard `$WOPAL_HOME/dsh` so isolation still holds.
  const resolvedHome = home ?? join(process.env.WOPAL_HOME ?? join(homedir(), ".wopal"), "dsh")
  const stateDir = join(resolvedHome, "state")
  // Profile patch rows that give the dsh plugins that read `config.dshHome`
  // (via `resolveDshHome(config.dshHome)`) an explicit home rooted at state.
  // These rows REPLACE each plugin's whole config, so any non-home fields the
  // base bundle sets (e.g. agent-instructions `maxBytes`) are restated here.
  //
  // Two plugins are genuine exceptions (B-02) that resolve the anonymous-user-id
  // and/or the upload index via `resolveDshHome()` with NO configurable home
  // seam and no schema-exposed path (verified against the plugin source):
  //   - llm-deepseek: `getOrCreateAnonymousUserId()` + `~/.dsh/llm-deepseek/files-v3.json`
  //   - session-telemetry-otel: `getOrCreateAnonymousUserId()` at
  //     `~/.dsh/.anonymous-user-id` when telemetry is enabled (it can be turned
  //     on by an inherited `DSH_TELEMETRY_MODE` env, not just the default
  //     DISABLED).
  // `resolveDshHome()` falls back to `~/.dsh` when `DSH_HOME` is unset, and we
  // must NOT set `process.env.DSH_HOME` (constraint #10, AC#4). Since there is
  // no injection seam, both features are DISABLED — the same degrade the tools
  // profile already applies — so neither write ever touches the user's default
  // `~/.dsh`. Re-enable only once dsh exposes a home seam or publishes the
  // adapters with a configurable home.
  const stateHomePatches: Record<string, unknown>[] = [
    { id: "settings", config: { dshHome: stateDir } },
    { id: "credentials", config: { dshHome: stateDir } },
    { id: "attachment-local", config: { dshHome: stateDir } },
    { id: "shell-env", config: { dshHome: stateDir } },
    { id: "agent-instructions", config: { dshHome: stateDir, maxBytes: 65536 } },
    { id: "skill-filesystem", config: { dshHome: stateDir } },
    { id: "llm-deepseek", disabled: true },
    { id: "session-telemetry-otel", disabled: true },
  ]
  // The dsh installation anchor: resolve the @deepseek-ai/dsh package.json
  // from this host package so loadProfile finds the bundle layers in the
  // host's node_modules closure. Desktop packaged mode overrides it to the
  // materialised closure copy under $WOPAL_HOME/dsh because require.resolve cannot
  // reach the resource directory from the bundled sidecar. The realpath is used
  // so profile resolution and the loader's node_modules walk reach the full
  // installed closure even when the anchor path is a symlink (pnpm layout,
  // test fixtures); for a real materialised closure it is a no-op.
  const installAnchor = realpathSync(opts.installAnchor ?? require.resolve("@deepseek-ai/dsh/package.json"))

  const { healProfilesModuleFallback, loadProfile, resolveProfileDir, initProfile } = runtime.appBoot
  // The dsh-plugins log Exporter is registered before any plugin mounts, so
  // every dsh plugin's ctx.logger output lands in the dedicated file. The
  // Exporter is auto-disposed with the host fiber (zero manual cleanup). The
  // closure-resolved runtime is injected so the exporter never falls back to
  // the host package closure on packaged hosts (B-01).
  if (logFile) {
    const exporter = createCordisLogExporter({
      logFile,
      minLevel: logLevel ?? "DEBUG",
      runtime,
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
  healProfilesModuleFallback(installAnchor, resolvedHome)

  // The tool-container profile seeds its default patch layer (disable the
  // agent-loop-only plugins) on first mount. The file is user-owned: once the
  // user edits it (anything beyond initProfile's empty template), it is never
  // overwritten.
  if (profileName === TOOLS_PROFILE_NAME) {
    const dir = resolveProfileDir(profileName, resolvedHome)
    initProfile(dir, runtime.appBoot.DEFAULT_PROFILE_BUNDLES)
    const patchPath = join(dir, runtime.appBoot.PROFILE_PATCH_FILENAME)
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
  const profile = loadProfile("ellamaka", profileName, installAnchor, resolvedHome)
  // Compose the effective patch list: bundle layers + profile layer + extras.
  const patches = [
    ...profile.layers.flatMap((layer) => layer.patches),
    ...profile.patches,
    ...extraPatches,
    ...stateHomePatches,
  ]
  const rootConfig = join(profile.dir, "cordis.yml")
  // The root config is the host-owned include: an empty entry list. The
  // bundle + profile patch layers carry every plugin.
  writeFileSync(rootConfig, "[]\n")

  // Replay the dsh boot() sequence on the host context (single container).
  ctx.baseUrl = pathToFileURL(dirname(rootConfig)).href + "/"
  // Override the ctx-injected `dshHomePath` so `!!js dshHomePath('sessions')`
  // (etc.) expressions in the bundle patch layers resolve under state/ — the
  // default resolver reads `$DSH_HOME`/`~/.dsh` (DESIGN-dsh-poc §3.4 A-type).
  ctx.provide("dshHomePath", (...segments: string[]) => join(stateDir, ...segments))
  const loaderFiber = await ctx.registry.plugin(runtime.pluginLoader)
  // Packaged-host bare-module bridge: bun-compiled binaries (CLI) and the
  // Desktop sidecar bundle carry no dsh packages, and bun SEA lacks Node's
  // internal ESM loader (cordis-plugin-loader's ModuleLoader.fromInternal()
  // returns undefined), so bare plugin names in the patch layers would fall
  // back to the host bundle and fail. Anchor a CJS require at the install
  // anchor instead: from a real disk path, require() resolves the whole
  // materialised closure regardless of cwd. The Loader normalises
  // ESM/CJS/default shapes before applying a plugin, so the exports object
  // is consumed identically. From source the internal loader exists and this
  // polyfill never engages.
  const loader = ctx.get("loader")
  if (loader !== undefined && loader.internal === undefined) {
    // `createClosureRequire` resolves the anchor's realpath first so the
    // node_modules walk reaches the materialised closure regardless of a
    // symlinked layout.
    const closureRequire = createClosureRequire(installAnchor)
    loader.internal = {
      import: async (name: string) => closureRequire(name),
    }
  }
  // Intrinsic host setup: the launch environment snapshot and the cmdline
  // service (--port) that the web-startup plugin reads to bind the webserver.
  const { DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot } = runtime.launchEnv
  ctx.provide(
    DSH_LAUNCH_ENVIRONMENT_KEY,
    createLaunchEnvironmentSnapshot([{ source: "process", values: process.env as Record<string, string> }]),
  )
  // `--no-open` keeps the dsh web UI from launching the default browser: the
  // Workbench embeds the dsh surface in an iframe, so an external tab is noise.
  runtime.cmdline.provideCmdline(ctx, { args: ["--port", String(port), "--no-open"], exit: () => {} })
  // In virtual mode, the VirtualWebServer is constructed before the Loader
  // mounts (its Service constructor registers it as `webServer`), so the
  // official web plugins register their routes against it instead of a real
  // socket. The official `webserver` entry is disabled via extraPatches.
  await prepare?.(ctx)
  // Bare package names in the patch layers (e.g. `@deepseek-ai/dsh-web-app`)
  // must resolve against the closure the install anchor lives in, not the
  // host module graph: a bundled host (packaged CLI bunfs, Desktop sidecar)
  // carries no dsh packages, so the Node internal loader resolves them via
  // this parent URL — the dsh home root, whose `node_modules/` ancestry holds
  // the materialised closure (DESIGN-dsh-poc §2.2). From source the same
  // closure is materialised too (the kill switch guards its absence), so
  // passing the base unconditionally is mode-independent.
  const bareModuleBaseUrl = pathToFileURL(join(installAnchor, "..", "..", "..")).href + "/"
  const includeEntry = await runtime.appBoot.mountRootInclude(ctx, rootConfig, patches, bareModuleBaseUrl)
  await ctx.get("loader")?.await()
  if (ctx.get("loader") === undefined || includeEntry === undefined) {
    throw new Error("ellamaka-cordis: dsh boot did not provide a loader service")
  }
  await runtime.appBoot.assertEntriesActivated(ctx, "ellamaka")

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
 * Mount the dsh web engine virtually onto an existing cordis context.
 *
 * Loads the `web` profile (dsh-base + dsh-web-app) and provides a
 * {@link VirtualWebServer} so the official web plugins register their routes
 * against it instead of a second listening socket. The official `webserver`
 * entry is disabled; `web-runtime`'s root-path URL printing and shell/prompt
 * injection are closed (the iframe serves under `/dsh`, so a root-path URL
 * would be a wrong entry point). `web-startup` and `provideCmdline` stay so
 * the port and trust judgement keep reading the Ellamaka public listener.
 *
 * @param ctx - the host cordis context (e.g. a CordisHub's ctx).
 * @param options - home, port, and optional prepare hook.
 * @returns a {@link DshWebHost} handle.
 */
export async function mountDshWeb(ctx: Context, opts: DshHostOptions): Promise<DshWebHost> {
  const runtime = opts.runtime ?? createPackageDshRuntimeApi()
  const virtualWebServer = new VirtualWebServer(ctx, { host: "127.0.0.1", port: opts.port, runtime })
  const host = await mountProfile(ctx, {
    ...opts,
    profileName: WEB_PROFILE_NAME,
    requireWebServer: true,
    virtualWebServer,
    extraPatches: [
      // Assemble the SHIPPED agent-preset root (`standard` etc.) the same way
      // the dsh CLI's composeProfile does — loadProfile alone does not inject
      // it, so without this the roster is empty and sessions cannot start.
      // Derived from the same install anchor the profile resolves packages
      // from, so a bundled host reads the materialised closure's presets.
      {
        id: "agent-presets",
        config: { default: "standard", roots: [{ path: shippedPresetRoot(opts.installAnchor), trust: "system" }] },
      },
      // code-runtime depends on node:module.stripTypeScriptTypes (Node 22.18+),
      // which the bun dev runtime lacks. It is a code-execution capability, not
      // part of the web UI chat surface. The CLI serve path (bun) disables it
      // via `disableCodeRuntime`; the Desktop sidecar (Node 22.18+) keeps it.
      ...(opts.disableCodeRuntime ? [{ id: "code-runtime", disabled: true }] : []),
      // The official webserver binds a real socket; the virtual profile
      // provides VirtualWebServer instead, so disable the real one.
      { id: "webserver", disabled: true },
      // The iframe serves under /dsh; a root-path URL would be a wrong entry
      // point, so close web-runtime's URL printing and shell/prompt injection.
      // Full config replacement preserves the connection-trust fields.
      {
        id: "web-runtime",
        config: { openBrowser: false, printUrl: false, surfaceContext: false, trustedHosts: [] },
      },
      ...(opts.extraPatches ?? []),
    ],
  })
  // Register the DSH iframe prefix adaptation as the last index tap: rewrite
  // static asset URLs to /dsh and inject the browser fetch/WebSocket/
  // EventSource adapter as a real <script> node (a bare text splice into
  // </head> would not execute). frontend-static renders the index through
  // applyIndexTaps, so this runs after the official taps.
  virtualWebServer.tapIndex((html) => {
    const rewritten = virtualWebServer.rewriteIndex(html)
    const script = `<script>${virtualWebServer.iframeAdapterScript()}</script>`
    return rewritten.replace("</head>", `${script}</head>`)
  })
  return {
    mountPath: DSH_MOUNT_PREFIX,
    webServer: virtualWebServer,
    // Dispose the VirtualWebServer first (closes every upgrade socket it
    // dispatched, per DESIGN-dsh-poc §2.1 item 10) before unmounting the
    // Loader, so Node closeAllConnections() does not strand raw WebSockets.
    dispose: async () => {
      virtualWebServer.dispose()
      await host.dispose()
    },
  }
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
export async function bootDshWeb(opts: DshHostOptions): Promise<DshWebHost> {
  const runtime = opts.runtime ?? createPackageDshRuntimeApi()
  const ctx = new runtime.cordis.Context()
  const host = await mountDshWeb(ctx, opts)
  return {
    mountPath: host.mountPath,
    webServer: host.webServer,
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
  const runtime = opts.runtime ?? createPackageDshRuntimeApi()
  const ctx = new runtime.cordis.Context()
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
