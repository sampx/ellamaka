import path from "path"
import { appendFileSync, mkdirSync } from "fs"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { resolveWopalSpaceRoot } from "@/config/wopal-space-settings"
import {
  cordisHubLayerWith,
  createCordisLogExporter,
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
 * Mounted per instance hub: the container log Exporter — cordis plugin
 * output is bridged to a per-instance `cordis-plugins.log` file (DESIGN
 * §6.4), keeping plugin logs out of the main ellamaka log.
 */

export interface CordisPluginAssemblyOptions {
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
}

/**
 * Build the hub-registry layer.
 *
 * Production uses {@link cordisPluginAssembly}; tests build their own with a
 * temp log file through the same factory (same code path, only parameters
 * differ).
 */
export function createCordisPluginAssembly(options: CordisPluginAssemblyOptions = {}) {
  const hubs = cordisHubLayerWith({
    onHubCreate: (hub, directory) => mountInstancePlugins(hub, directory, options),
  })
  return { hubs }
}

/** The production assembly: per-instance cordis-plugins.log file. */
export const cordisPluginAssembly = createCordisPluginAssembly()

export * as CordisMount from "./cordis-mount"
