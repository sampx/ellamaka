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

    // Optional dsh web engine (single-process dual-port, PoC §7.11).
    // Enabled via ELLAMAKA_DSH=1; mounts the dsh web profile onto a
    // process-level cordis hub — one process, one container. When disabled,
    // nothing dsh-related is mounted and ellamaka runs untouched.
    if (Flag.ELLAMAKA_DSH) {
      // Dynamic import keeps the dsh assembly out of the desktop sidecar
      // bundle: `serve.ts` is bundled into `dist/node/node.js`, which the
      // desktop sidecar loads under Node. A static top-level import would pull
      // @wopal/ellamaka-cordis (and its @deepseek-ai/dsh-* dependency closure)
      // into that bundle, where Node cannot resolve the dsh packages — the
      // sidecar crashed on load. Only ELLAMAKA_DSH-enabled CLI runs reach here.
      const [{ CordisHub }, { mountDshWeb }] = yield* Effect.all([
        Effect.promise(() => import("@wopal/ellamaka-cordis")),
        Effect.promise(() => import("@wopal/ellamaka-cordis/dsh-web")),
      ])
      const hub = new CordisHub(null)
      // Fixed loopback port so the Workbench /dsh iframe can address it without
      // a runtime port-discovery round trip (dev 4098; Desktop uses a random
      // port via its own sidecar wiring in a later phase).
      const dsh = yield* Effect.promise(() =>
        mountDshWeb(hub.ctx, {
          port: 4098,
          logFile: join(Global.Path.log, "dsh-plugins.log"),
        }),
      )
      console.log(`dsh web engine listening on ${dsh.url}`)
      // Probe the dsh-plugins log Exporter so the bridge is observable even
      // when the dsh engine boots silently (no plugin logs yet).
      hub.ctx.logger("dsh-web").info("dsh engine mounted")

      // Experiment 2 (dsh-tool adapter): mount fs-search onto the container's
      // global layer (the web profile's agent-plane presets stay empty) and
      // expose the container so the dsh-adapter plugin can project container
      // tools into ellamaka's ToolRegistry. The adapter file declares the
      // adoption allow-list; globalThis is the experiment-grade hand-off.
      yield* Effect.promise(async () => {
        const { createRequire } = await import("node:module")
        // Resolve the dsh closure through the ellamaka-cordis module (the only
        // package whose dependencies include @deepseek-ai/dsh) — serve.ts's own
        // resolution root (packages/opencode) cannot see those packages.
        const anchorRequire = createRequire(
          import.meta.resolve("@wopal/ellamaka-cordis/package.json"),
        )
        const anchorDir = anchorRequire
          .resolve("@deepseek-ai/dsh/package.json")
          .replace("/package.json", "")
        const dshReq = createRequire(`${anchorDir}/package.json`)
        const fsSearch = await import(dshReq.resolve("@deepseek-ai/dsh-tool-fs-search"))
        const config = fsSearch.Config({ sampleOverCapGlobResults: false })
        await Promise.resolve(hub.ctx.plugin(fsSearch as never, config as never))
        const tools = hub.ctx.get("tools")
        hub.ctx.logger("dsh-web").info("fs-search mounted", {
          tools: tools ? tools.schemas().length : 0,
        })
        ;(globalThis as Record<string, unknown>).__ellamakaDshContainer = hub.ctx
      })

      yield* Effect.never.pipe(Effect.ensuring(Effect.promise(() => hub.dispose())))
    } else {
      yield* Effect.never
    }
  }),
})
