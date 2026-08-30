import { Global } from "@opencode-ai/core/global"
import { join } from "node:path"
import {
  DEFAULT_DSH_RUNTIME_MANIFEST,
  initializeDshRuntime,
  resolveInstallAnchor,
} from "@wopal/ellamaka-cordis/runtime"
import { createDshRuntimeApi } from "@wopal/ellamaka-cordis/runtime/loader"

const CONTAINER_KEY = "__ellamakaDshContainer"

export interface DshMountOptions {
  /** The wopal home (`$WOPAL_HOME`); the dsh home derives as `<home>/dsh`. */
  wopalHome?: string
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
 * Assembly (DESIGN-dsh-poc §3.4.4): the unified Runtime Manager gates on
 * `ELLAMAKA_DSH` itself (`=0` → `disabled` with zero file access) and is
 * called unconditionally; `ready` mounts the tool container with the closure
 * runtime injected; `disabled`/`degraded` return `undefined` and the TUI runs
 * untouched.
 */
export async function mountDshIfEnabled(opts: DshMountOptions = {}): Promise<DshMountHandle | undefined> {
  const wopalHome = opts.wopalHome ?? Global.Path.wopalHome
  const logFile = opts.logFile ?? join(Global.Path.log, "dsh-plugins.log")
  const manifest = DEFAULT_DSH_RUNTIME_MANIFEST

  const status = await initializeDshRuntime({
    wopalHome,
    logFile,
    entry: "tui",
    manifest,
  })
  if (status !== "ready") return undefined

  const anchor = resolveInstallAnchor(wopalHome, manifest)
  const runtime = createDshRuntimeApi(anchor.path)
  const { CordisHub } = await import("@wopal/ellamaka-cordis")
  const { mountDshTools } = await import("@wopal/ellamaka-cordis/dsh-web")
  const hub = new CordisHub(null)
  const host = await mountDshTools(hub.ctx, {
    home: join(wopalHome, "dsh"),
    port: 0,
    logFile,
    installAnchor: anchor.path,
    runtime,
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
