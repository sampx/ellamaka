import { Effect } from "effect"
import { join } from "node:path"
import { Server } from "../../server/server"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { BINARY_NAME } from "../../../../ellamaka/branding"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: `starts a headless ${BINARY_NAME} server`,
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`${BINARY_NAME} server listening on http://${server.hostname}:${server.port}`)

    // Optional dsh engine (single-process, dual-container).
    // Enabled via ELLAMAKA_DSH=1. Two cordis containers share the process:
    //  - the web container (web profile, untouched) serves the dsh UI the
    //    Workbench iframe embeds
    //  - the tool container (ellamaka-tools profile) is the adapter's tool
    //    backend; its profile patch layer disables the agent-loop-only
    //    plugins so tools run with a lightweight per-call context.
    // When disabled, nothing dsh-related is mounted and ellamaka runs
    // untouched.
    if (Flag.ELLAMAKA_DSH) {
      // Dynamic import keeps the dsh assembly out of the desktop sidecar
      // bundle: `serve.ts` is bundled into `dist/node/node.js`, which the
      // desktop sidecar loads under Node. A static top-level import would pull
      // @wopal/ellamaka-cordis (and its @deepseek-ai/dsh-* dependency closure)
      // into that bundle, where Node cannot resolve the dsh packages — the
      // sidecar crashed on load. Only ELLAMAKA_DSH-enabled CLI runs reach here.
      const [{ CordisHub }, { mountDshTools, mountDshWeb }] = yield* Effect.all([
        Effect.promise(() => import("@wopal/ellamaka-cordis")),
        Effect.promise(() => import("@wopal/ellamaka-cordis/dsh-web")),
      ])
      const webHub = new CordisHub(null)
      const toolsHub = new CordisHub(null)
      // The dsh web engine mounts on the same Ellamaka listener under /dsh
      // (single-port scheme, DESIGN-dsh-poc §2.1). The CLI serve runtime is
      // bun, which lacks node:module.stripTypeScriptTypes, so code-runtime is
      // disabled here; the Desktop sidecar (Node 22.18+) keeps it enabled.
      const dsh = yield* Effect.promise(() =>
        mountDshWeb(webHub.ctx, {
          home: join(Global.Path.wopalHome, "dsh"),
          port: server.port,
          logFile: join(Global.Path.log, "dsh-plugins.log"),
          disableCodeRuntime: true,
        }),
      )
      // Mount the VirtualWebServer under /dsh on the Ellamaka listener. The
      // mount strips the prefix and passes the stripped URL to the virtual
      // server's request/upgrade dispatch.
      const unmountDsh = server.mountNodeRoute({
        prefix: dsh.mountPath,
        request: (req, res) => dsh.webServer.request(req, res),
        upgrade: (req, socket, head) => dsh.webServer.upgrade(req, socket, head),
      })
      console.log(`dsh web engine mounted at ${dsh.mountPath}`)
      // Probe the dsh-plugins log Exporter so the bridge is observable even
      // when the dsh engine boots silently (no plugin logs yet).
      webHub.ctx.logger("dsh-web").info("dsh engine mounted")

      // Tool container for the dsh status adapter: base profile with the
      // agent-loop plugins disabled via the profile patch layer. The
      // container is exposed so the dsh-adapter plugin can project container
      // tools into ellamaka's ToolRegistry; the adapter file declares the
      // adoption allow-list.
      const tools = yield* Effect.promise(() =>
        mountDshTools(toolsHub.ctx, {
          home: join(Global.Path.wopalHome, "dsh"),
          port: 0,
          logFile: join(Global.Path.log, "dsh-plugins.log"),
        }),
      )
      toolsHub.ctx.logger("dsh-tools").info("tool container mounted")
      ;(globalThis as Record<string, unknown>).__ellamakaDshContainer = toolsHub.ctx

      yield* Effect.never.pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            unmountDsh()
            // dsh.dispose() closes the VirtualWebServer's upgrade sockets first,
            // then unmounts the dsh plugin tree from the web hub.
            await dsh.dispose()
            await webHub.dispose()
            await toolsHub.dispose()
          }),
        ),
      )
    } else {
      yield* Effect.never
    }
  }),
})
