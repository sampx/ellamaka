import { CordisHub } from "@wopal/ellamaka-cordis"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { join } from "node:path"

const CONTAINER_KEY = "__ellamakaDshContainer"

export interface DshMountOptions {
  /** The dsh home directory (`$WOPAL_HOME/dsh`). */
  home?: string
  /** Path to the dedicated dsh-plugins log file. */
  logFile?: string
}

export interface DshMountHandle {
  dispose(): Promise<void>
}

/**
 * Mount the dsh tool container for the in-process TUI.
 *
 * The TUI has no iframe surface, so it mounts only the tool container
 * (ellamaka-tools profile, agent-loop plugins disabled) and exposes it on
 * `globalThis.__ellamakaDshContainer` for the dsh-adapter plugin. Tools then
 * execute with a lightweight per-call context — no live dsh sessions.
 *
 * Enabled via ELLAMAKA_DSH=1. When disabled, nothing dsh-related is mounted
 * and the TUI runs untouched.
 */
export async function mountDshIfEnabled(opts: DshMountOptions = {}): Promise<DshMountHandle | undefined> {
  if (!Flag.ELLAMAKA_DSH) return undefined
  const { mountDshTools } = await import("@wopal/ellamaka-cordis/dsh-web")
  const hub = new CordisHub(null)
  const host = await mountDshTools(hub.ctx, {
    home: opts.home ?? join(Global.Path.wopalHome, "dsh"),
    port: 0,
    logFile: opts.logFile ?? join(Global.Path.log, "dsh-plugins.log"),
  })
  ;(globalThis as Record<string, unknown>)[CONTAINER_KEY] = hub.ctx
  return {
    dispose: async () => {
      delete (globalThis as Record<string, unknown>)[CONTAINER_KEY]
      await host.dispose()
      await hub.dispose()
    },
  }
}
