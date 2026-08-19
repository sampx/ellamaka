import path from "path"
import { appendFileSync, mkdirSync } from "fs"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Layer } from "effect"
import { GrepBridgeService } from "@/tool/registry"
import { resolveWopalSpaceRoot } from "@/config/wopal-space-settings"
import {
  cordisHubLayerWith,
  createCordisLogExporter,
  createGrepBridgeLayer,
  mountSpillPlugins,
  type CordisHub,
} from "@wopal/ellamaka-cordis"

/**
 * Production cordis plugin assembly (code-direct mounting, DESIGN D-04).
 *
 * Every per-instance hub starts with the same plugin set, mounted by the
 * `onHubCreate` hook before any dispatch can use the hub. The configured
 * declaration path (settings.json -> ConfigBridge, DESIGN §5.8) replaces
 * this hardcoded list in a later Plan - this module is the assembly seam
 * both paths will meet at.
 *
 * Mounted per instance hub (POC 1.7):
 * - spill trio (`LocalSpillStore` + `SpillPolicy`): oversized plain-text tool
 *   results are dumped to disk and replaced with a bounded preview + locator.
 *
 * Routed through the ctx.tools pipeline (POC 1.6):
 * - builtin grep: the native execution body is bridged through the hub's
 *   `ctx.tools` (register -> execute -> `tools/post-execute` waterfall), so
 *   policies like spill apply to it. The native grep itself (ripgrep,
 *   permission, identity, truncation) is unchanged - the pipe is replaced,
 *   not the tool.
 */

/**
 * Model-facing inline cap for a plain-text tool result (UTF-8 bytes).
 *
 * The native grep truncates to ~100 lines first, so 8KB keeps valuable
 * mid-size results (code spans of a few KB) fully inline while oversized
 * haystack-style outputs (a full 100-line × 80-char block ≈ 8-10KB) spill
 * to disk. The spilled preview's budget is bounded by this same cap, so a
 * spilled result never puts more than 8KB into model context. Smaller caps
 * save tokens but push mid-size results into an extra read round-trip.
 */
export const SPILL_MAX_INLINE_BYTES = 8 * 1024

/**
 * Spill dump root. Session-scoped subdirectories (`session-<hash>`) are
 * created by the store, so one root is shared safely across instances and
 * sessions. Lives under ellamaka's data dir (Global.Path.data), not the user
 * project, so dumps never pollute or get scanned by project greps.
 */
export function spillRoot(): string {
  return path.join(Global.Path.data, "spill")
}

export interface CordisPluginAssemblyOptions {
  /** Spill dump root; defaults to {@link spillRoot}. */
  readonly spillRoot?: string
  /** Inline cap in UTF-8 bytes; defaults to {@link SPILL_MAX_INLINE_BYTES}. */
  readonly maxInlineBytes?: number
  /** cordis-plugins log file path; defaults to {@link cordisPluginsLogFile}. */
  readonly logFile?: string
  /** Minimum log level for cordis plugin output; defaults to ellamaka current level. */
  readonly logLevel?: "DEBUG" | "INFO" | "WARN" | "ERROR"
}

/**
 * Path to the cordis-plugins log file for an instance directory.
 *
 * Wopal-space instances log to the space's canonical logs dir
 * (`<space>/.wopal-space/logs/`); non-space instances log to the global
 * `$WOPAL_HOME/logs/`. One file per mode — the decision is made from the
 * instance directory, never from process-level `Log.file()` state (which is
 * empty under `--print-logs`).
 */
export function cordisPluginsLogFile(directory: string): string {
  const spaceRoot = resolveWopalSpaceRoot(directory)
  const dir = spaceRoot ? path.join(spaceRoot, ".wopal-space", "logs") : Global.Path.log
  return path.join(dir, "cordis-plugins.log")
}

/**
 * Mount the per-instance plugin set onto a freshly created hub.
 *
 * Fails loud: a mount error fails the hub resolution (an assembly bug must
 * never yield a silently half-mounted container).
 */
export async function mountInstancePlugins(
  hub: CordisHub,
  directory: string,
  options: CordisPluginAssemblyOptions = {},
): Promise<void> {
  const logFile = options.logFile ?? cordisPluginsLogFile(directory)
  const minLevel = options.logLevel ?? Log.currentLevel()
  const exporter = createCordisLogExporter({
    logFile,
    minLevel,
    write: (line) => {
      try {
        appendFileSync(logFile, line, "utf-8")
      } catch {
        // first write: ensure directory exists, then retry once
        try {
          mkdirSync(path.dirname(logFile), { recursive: true })
          appendFileSync(logFile, line, "utf-8")
        } catch {
          // silently ignore — log write failures must never break the hub
        }
      }
    },
  })
  hub.ctx.logger.exporter(exporter)

  // Now that the Exporter is registered, emit the hub "created" lifecycle
  // log so it reaches cordis-plugins.log (DESIGN §5.10). The constructor ran
  // before the Exporter existed, so it could not log there.
  hub.ctx.logger("cordis-hub").info("created")

  await mountSpillPlugins(hub.ctx, {
    root: options.spillRoot ?? spillRoot(),
    maxInlineBytes: options.maxInlineBytes ?? SPILL_MAX_INLINE_BYTES,
  })
}

/**
 * Build the hub-registry + grep-bridge layer pair sharing one registry.
 *
 * Production uses {@link cordisPluginAssembly}; tests build their own with a
 * temp spill root through the same factory (same code path, only parameters
 * differ).
 */
export function createCordisPluginAssembly(options: CordisPluginAssemblyOptions = {}) {
  const hubs = cordisHubLayerWith({
    onHubCreate: (hub, directory) => mountInstancePlugins(hub, directory, options),
  })
  const grepBridge = createGrepBridgeLayer(GrepBridgeService).pipe(Layer.provide(hubs))
  return { hubs, grepBridge }
}

/** The production assembly: spill root under ellamaka's data dir, 20KB cap. */
export const cordisPluginAssembly = createCordisPluginAssembly()

export * as CordisMount from "./cordis-mount"
