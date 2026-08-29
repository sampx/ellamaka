import { CordisHub } from "@wopal/ellamaka-cordis"
import { mountDshTools, mountDshWeb } from "@wopal/ellamaka-cordis/dsh-web"
import { Global } from "@opencode-ai/core/global"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Listener } from "../../server/server"

/**
 * Resolve the dsh installation anchor for a packaged host: the materialised
 * closure under `$WOPAL_HOME/dsh` (DESIGN-dsh-poc §2.2). Returns `undefined`
 * when the closure is absent — the caller's kill switch (skip mounting, keep
 * the host running).
 *
 * Unlike `require.resolve`, this never touches the module graph: a compiled
 * CLI binary (bunfs) or the Desktop sidecar bundle carries no dsh packages,
 * so resolution must go through the filesystem anchor.
 */
export function resolveDshAnchor(home: string): string | undefined {
  const anchor = join(home, "node_modules", "@deepseek-ai", "dsh", "package.json")
  return existsSync(anchor) ? anchor : undefined
}

export interface DshEngineMountOptions {
  /** Override the dsh home; defaults to `$WOPAL_HOME/dsh`. */
  home?: string
  /** Override the dsh-plugins log file; defaults to `$WOPAL_HOME/logs/dsh-plugins.log`. */
  logFile?: string
}

export interface DshEngineHandle {
  /** The mount path the dsh web engine serves under (always `/dsh`). */
  readonly mountPath: string
  dispose(): Promise<void>
}

/**
 * Mount the full dsh engine (web + tool containers) on a running Ellamaka
 * server under `/dsh` (single-port scheme, DESIGN-dsh-poc §2.1). Shared by
 * the `serve` and `web` commands; the TUI uses its tools-only variant in
 * `tui/dsh-mount.ts`.
 *
 * The caller is responsible for gating on `Flag.ELLAMAKA_DSH` — this module
 * mounts unconditionally so command handlers stay linear.
 *
 * Kill switch: when the dsh home has no materialised closure
 * (`resolveDshAnchor` → undefined), nothing mounts and `undefined` is
 * returned; the host keeps running untouched (equivalent to
 * `ELLAMAKA_DSH=0`, §2.2 kill-switch semantics).
 */
export async function mountDshEngine(server: Listener, opts: DshEngineMountOptions = {}): Promise<DshEngineHandle | undefined> {
  const home = opts.home ?? join(Global.Path.wopalHome, "dsh")
  const logFile = opts.logFile ?? join(Global.Path.log, "dsh-plugins.log")
  const installAnchor = resolveDshAnchor(home)
  if (!installAnchor) {
    console.warn(
      `dsh engine disabled: no materialised closure at ${home} (run the dsh materialise script; see DESIGN-dsh-poc §2.2)`,
    )
    return undefined
  }

  const { CordisHub } = await import("@wopal/ellamaka-cordis")
  const webHub = new CordisHub(null)
  const toolsHub = new CordisHub(null)
  // The CLI serve/web runtime is bun, which lacks
  // node:module.stripTypeScriptTypes, so code-runtime is disabled here; the
  // Desktop sidecar (Node 22.18+) keeps it enabled.
  const dsh = await mountDshWeb(webHub.ctx, {
    home,
    port: server.port,
    logFile,
    installAnchor,
    disableCodeRuntime: true,
  })
  const unmountDsh = server.mountNodeRoute({
    prefix: dsh.mountPath,
    request: (req, res) => dsh.webServer.request(req, res),
    upgrade: (req, socket, head) => dsh.webServer.upgrade(req, socket, head),
  })
  console.log(`dsh web engine mounted at ${dsh.mountPath}`)
  webHub.ctx.logger("dsh-web").info("dsh engine mounted")

  const toolsHost = await mountDshTools(toolsHub.ctx, {
    home,
    port: 0,
    logFile,
    installAnchor,
  })
  toolsHub.ctx.logger("dsh-tools").info("tool container mounted")
  ;(globalThis as Record<string, unknown>).__ellamakaDshContainer = toolsHub.ctx

  return {
    mountPath: dsh.mountPath,
    dispose: async () => {
      // dsh.dispose() closes the VirtualWebServer's upgrade sockets first,
      // then unmounts the dsh plugin tree from the web hub.
      unmountDsh()
      await dsh.dispose()
      await toolsHost.dispose()
      await webHub.dispose()
      await toolsHub.dispose()
    },
  }
}
