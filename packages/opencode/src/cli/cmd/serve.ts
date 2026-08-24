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
      // Fixed loopback port so the Workbench /dsh iframe can address it without
      // a runtime port-discovery round trip (dev 4098; Desktop uses a random
      // port via its own sidecar wiring in a later phase).
      const dsh = yield* Effect.promise(() =>
        mountDshWeb(webHub.ctx, {
          port: 4098,
          logFile: join(Global.Path.log, "dsh-plugins.log"),
        }),
      )
      console.log(`dsh web engine listening on ${dsh.url}`)
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
          port: 0,
          logFile: join(Global.Path.log, "dsh-plugins.log"),
        }),
      )
      toolsHub.ctx.logger("dsh-tools").info("tool container mounted")
      ;(globalThis as Record<string, unknown>).__ellamakaDshContainer = toolsHub.ctx

      yield* Effect.never.pipe(
        Effect.ensuring(
          Effect.promise(async () => {
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
