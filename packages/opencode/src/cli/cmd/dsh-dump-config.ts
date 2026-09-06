import { Effect } from "effect"
import { join } from "node:path"
import { Global } from "@wopal/ellamaka-core/global"
import {
  DEFAULT_DSH_RUNTIME_MANIFEST,
  resolveInstallAnchor,
} from "@wopal/ellamaka-cordis/runtime"
import { createDshRuntimeApi } from "@wopal/ellamaka-cordis/runtime/loader"
import {
  composeDshDumpProfileLayers,
  dumpDshConfig,
  type DshDumpPayload,
} from "@wopal/ellamaka-cordis/diagnostics/dump-config"
import { CliError, effectCmd } from "../effect-cmd"

export const DshDumpConfigCommand = effectCmd({
  command: "dump-config",
  describe: "dump composed dsh patch layers for a profile without booting",
  instance: false,
  // Documented "without booting" — the handler only reads closure + profile
  // files; AppRuntime construction would violate that contract.
  light: true,
  builder: (yargs) =>
    yargs
      .option("profile", {
        type: "string",
        default: "web",
        describe: "the profile name to inspect",
      })
      .option("default-only", {
        type: "boolean",
        default: false,
        describe: "dump bundle layers only (recovery diagnostic)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output JSON schema payload instead of rendered YAML",
      }),
  handler: Effect.fn("Cli.dshDumpConfig")(function* (args) {
    const profileName = String(args.profile ?? "web")
    const defaultOnly = Boolean(args["default-only"])

    const wopalHome = Global.Path.wopalHome
    const { runtime, anchorPath } = yield* Effect.try({
      try: () => {
        const anchor = resolveInstallAnchor(wopalHome, DEFAULT_DSH_RUNTIME_MANIFEST)
        return {
          runtime: createDshRuntimeApi(anchor.path),
          anchorPath: anchor.path,
        }
      },
      catch: () =>
        new CliError({
          message: "dsh runtime closure not found; run 'ellamaka serve' once to materialise it",
        }),
    })

    const dumpOptions = {
      wopalHome,
      profileName,
      defaultOnly,
      runtime,
      dshHome: join(wopalHome, "dsh"),
      installAnchor: anchorPath,
    } as const

    if (args.json) {
      // The JSON envelope and the YAML dump share ONE composition
      // (composeDshDumpProfileLayers) — the layer list can never drift
      // between the two output shapes.
      const { layers } = yield* Effect.tryPromise({
        try: () => composeDshDumpProfileLayers(dumpOptions),
        catch: toCliErrorMessage,
      })
      const payload: DshDumpPayload = {
        schema: "ellamaka.dsh-dump-config/v1",
        profile: profileName,
        defaultOnly,
        layers,
      }
      process.stdout.write(JSON.stringify(payload) + "\n")
      return
    }

    const dumped = yield* Effect.tryPromise({
      try: () => dumpDshConfig(dumpOptions),
      catch: toCliErrorMessage,
    })
    process.stdout.write(dumped.endsWith("\n") ? dumped : dumped + "\n")
  }),
})

function toCliErrorMessage(err: unknown): CliError {
  const message = err instanceof Error ? err.message : String(err)
  // The closure's profile errors teach the official bare `dsh plugin` command,
  // which ellamaka does not ship. Redirect to the ellamaka command surface
  // (B1.5 goal: eliminate the bare-`dsh` incitement source).
  if (message.includes("dsh plugin --profile")) {
    return new CliError({
      message: `${message}\n(in ellamaka, use: \`ellamaka dsh plugin --profile <name> add <package>\`)`,
    })
  }
  return new CliError({ message })
}
