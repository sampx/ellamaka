import { log } from "@clack/prompts"
import { Effect } from "effect"
import { join } from "node:path"
import { Global } from "@wopal/ellamaka-core/global"
import {
  installPackage,
  NotInstalledError,
  removePackage,
} from "@wopal/ellamaka-cordis/plugins/installer"
import { readStore, setEnabled, updateStore } from "@wopal/ellamaka-cordis/plugins"
import { parseProfiles, parseRegistrySpec } from "./dsh-plugin-profiles"
import { CliError, effectCmd, fail } from "../effect-cmd"

/**
 * `ellamaka dsh plugin` command group (DESIGN-dsh-poc §9.3).
 *
 * Every subcommand is a pure disk operation (install dir + store write); the
 * running server process watches the store and hot-mounts (D-02). The CLI
 * never touches containers directly. All store mutations go through
 * `updateStore` (read-modify-write under the plugins mutex), so concurrent
 * CLI processes never lose updates (rook B-04).
 */

const RISK_NOTE =
  "Third-party dsh plugins run in the same process as Ellamaka with filesystem and shell access. Only install plugins you trust."

function dshHome(): string {
  return join(Global.Path.wopalHome, "dsh")
}

/** Map a store/installer error to a user-visible CliError. */
function toCliError(error: unknown): CliError {
  if (error instanceof NotInstalledError) {
    return new CliError({ message: error.message })
  }
  return new CliError({ message: error instanceof Error ? error.message : String(error) })
}

export const DshPluginCommand = effectCmd({
  command: "dsh plugin <action> [pkg]",
  describe: "manage dsh plugins (add/remove/enable/disable/list)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["add", "remove", "enable", "disable", "list"] as const,
        describe: "the plugin operation",
      })
      .positional("pkg", {
        type: "string",
        describe: "package name (pkg[@version] for add; name for the rest)",
      })
      .option("dir", {
        type: "string",
        describe: "install from a local directory (add only)",
      })
      .option("profile", {
        type: "string",
        describe: 'comma-separated profile list, e.g. "web,tools" (default: web,ellamaka-tools)',
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "machine-readable output (list only)",
      }),
  handler: Effect.fn("Cli.dshPlugin")(function* (args) {
    const action = String(args.action ?? "")
    const pkg = args.pkg ? String(args.pkg) : undefined
    const home = dshHome()

    if (action === "add") {
      const profiles = parseProfiles(args.profile as string | undefined)
      if (!pkg && !args.dir) return yield* fail("dsh plugin add requires <pkg> or --dir <path>")
      if (pkg && args.dir) return yield* fail("dsh plugin add accepts either <pkg> or --dir, not both")
      const result = yield* Effect.tryPromise({
        try: () =>
          args.dir
            ? installPackage({ kind: "dir", path: args.dir }, { home, enabledIn: profiles })
            : installPackage(parseRegistrySpec(pkg!), { home, enabledIn: profiles }),
        catch: toCliError,
      })
      log.success(`Installed ${result.name}@${result.version} (${result.source})`)
      log.info(`Enabled in: ${profiles.join(", ")}`)
      if (result.warning) log.warn(result.warning)
      log.info("A running ellamaka server picks this up within ~2s; otherwise it mounts at next boot.")
      return
    }

    if (action === "remove") {
      if (!pkg) return yield* fail("dsh plugin remove requires <pkg>")
      yield* Effect.tryPromise({
        try: () => removePackage(pkg, { home }),
        catch: toCliError,
      })
      log.success(`Removed ${pkg}`)
      log.info("A running ellamaka server unmounts it within ~2s.")
      return
    }

    if (action === "enable" || action === "disable") {
      if (!pkg) return yield* fail(`dsh plugin ${action} requires <pkg>`)
      const enabled = action === "enable"
      // One locked read-modify-write (rook B-04): the read happens INSIDE the
      // plugins mutex, so two concurrent CLI processes never overwrite each
      // other's profile flips.
      const finalProfiles: string[] = yield* Effect.tryPromise({
        try: async () => {
          const result = await updateStore<string[]>(home, (store) => {
            const entry = store.plugins.find((p) => p.name === pkg)
            if (!entry) throw new NotInstalledError(pkg)
            // enable: the requested profiles (alias-expanded). disable without
            // --profile: both built-ins; with --profile: exactly those.
            const targets = enabled
              ? parseProfiles(args.profile as string | undefined)
              : args.profile
                ? parseProfiles(args.profile as string)
                : ["web", "ellamaka-tools"]
            for (const profile of targets) {
              setEnabled(store, pkg, profile, enabled)
            }
            return { result: entry.enabledIn.slice(), store }
          })
          return result ?? []
        },
        catch: toCliError,
      })
      log.success(`${enabled ? "Enabled" : "Disabled"} ${pkg}`)
      log.info(`Enabled in: ${finalProfiles.length ? finalProfiles.join(", ") : "(none)"}`)
      return
    }

    if (action === "list") {
      const plugins = yield* Effect.try({
        try: () => readStore(home).plugins,
        catch: toCliError,
      })
      if (args.json) {
        process.stdout.write(JSON.stringify({ schema: "ellamaka.dsh-plugins/v1", plugins }) + "\n")
        return
      }
      if (plugins.length === 0) {
        log.info("No dsh plugins installed.")
        return
      }
      for (const entry of plugins) {
        log.info(`${entry.name}@${entry.version}  [${entry.source}]  enabled: ${entry.enabledIn.join(", ") || "(none)"}`)
      }
      return
    }

    return yield* fail(`unknown dsh plugin action: ${action} (expected add|remove|enable|disable|list)`)
  }),
})