import { intro, log, outro } from "@clack/prompts"
import { Effect } from "effect"
import { join } from "node:path"
import { Global } from "@wopal/ellamaka-core/global"
import {
  AlreadyInstalledError,
  installPackage,
  listInstalled,
  NotInstalledError,
  removePackage,
} from "@wopal/ellamaka-cordis/plugins/installer"
import { readStore, setEnabled, writeStore } from "@wopal/ellamaka-cordis/plugins"
import { CliError, effectCmd, fail } from "../effect-cmd"

/**
 * `ellamaka dsh plugin` command group (DESIGN-dsh-poc §9.3).
 *
 * Every subcommand is a pure disk operation (install dir + store write); the
 * running server process watches the store and hot-mounts (D-02). The CLI
 * never touches containers directly.
 */

/** The two built-in profiles a plugin can be enabled in. */
const BUILTIN_PROFILES: readonly string[] = ["web", "ellamaka-tools"]

const RISK_NOTE =
  "Third-party dsh plugins run in the same process as Ellamaka with filesystem and shell access. Only install plugins you trust."

function dshHome(): string {
  return join(Global.Path.wopalHome, "dsh")
}

function parseProfiles(spec: string | undefined): string[] {
  if (!spec) return [...BUILTIN_PROFILES]
  const names = spec
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
  if (names.length === 0) return [...BUILTIN_PROFILES]
  const unknown = names.filter((name) => !BUILTIN_PROFILES.includes(name))
  if (unknown.length > 0) {
    throw new Error(`unknown profile(s): ${unknown.join(", ")} (built-in: ${BUILTIN_PROFILES.join(", ")})`)
  }
  return names
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
        describe: `comma-separated profile list (default: ${BUILTIN_PROFILES.join(",")})`,
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
      intro(`Install dsh plugin ${pkg ?? args.dir}`)
      log.warn(RISK_NOTE)
      const result = yield* Effect.tryPromise({
        try: () =>
          args.dir
            ? installPackage({ kind: "dir", path: args.dir }, { home, enabledIn: profiles })
            : installPackage(parseRegistrySpec(pkg!), { home, enabledIn: profiles }),
        catch: (error) => new CliError({ message: error instanceof Error ? error.message : String(error) }),
      })
      log.success(`Installed ${result.name}@${result.version} (${result.source})`)
      log.info(`Enabled in: ${profiles.join(", ")}`)
      if (result.warning) log.warn(result.warning)
      log.info("A running ellamaka server picks this up within ~2s; otherwise it mounts at next boot.")
      outro("Done")
      return
    }

    if (action === "remove") {
      if (!pkg) return yield* fail("dsh plugin remove requires <pkg>")
      yield* Effect.tryPromise({
        try: () => removePackage(pkg, { home }),
        catch: (error) => new CliError({ message: error instanceof Error ? error.message : String(error) }),
      })
      log.success(`Removed ${pkg}`)
      log.info("A running ellamaka server unmounts it within ~2s.")
      return
    }

    if (action === "enable" || action === "disable") {
      if (!pkg) return yield* fail(`dsh plugin ${action} requires <pkg>`)
      const profiles = parseProfiles(args.profile as string | undefined)
      const enabled = action === "enable"
      const store = yield* Effect.sync(() => readStore(home))
      let next = store
      for (const profile of (enabled ? profiles : args.profile ? profiles : BUILTIN_PROFILES)) {
        next = setEnabled(next, pkg, profile, enabled)
      }
      yield* Effect.tryPromise({
        try: () => writeStore(home, next),
        catch: (error) => new CliError({ message: error instanceof Error ? error.message : String(error) }),
      })
      const entry = next.plugins.find((p) => p.name === pkg)
      log.success(`${enabled ? "Enabled" : "Disabled"} ${pkg}`)
      log.info(`Enabled in: ${entry?.enabledIn.length ? entry.enabledIn.join(", ") : "(none)"}`)
      return
    }

    if (action === "list") {
      const plugins = yield* Effect.sync(() => readStore(home).plugins)
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

/** Parse `pkg[@version]` into an installer registry spec. */
function parseRegistrySpec(spec: string): { kind: "registry"; name: string; version?: string } {
  if (spec.startsWith("@")) {
    const idx = spec.indexOf("@", 1)
    if (idx === -1) return { kind: "registry", name: spec }
    return { kind: "registry", name: spec.slice(0, idx), version: spec.slice(idx + 1) }
  }
  const idx = spec.indexOf("@")
  if (idx === -1) return { kind: "registry", name: spec }
  return { kind: "registry", name: spec.slice(0, idx), version: spec.slice(idx + 1) }
}