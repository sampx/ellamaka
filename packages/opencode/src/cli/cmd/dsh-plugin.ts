import { log } from "@clack/prompts"
import { Effect } from "effect"
import { join } from "node:path"
import { Global } from "@wopal/ellamaka-core/global"
import {
  installPackage,
  NotInstalledError,
  removePackage,
  listInstalled,
} from "@wopal/ellamaka-cordis/plugins/installer"
import { migratePluginStore } from "@wopal/ellamaka-cordis/plugins/migrate-store"
import { disableRow, enableRow, readUserPatchState } from "@wopal/ellamaka-cordis/plugins/patch-layer"
import { assertNotGithubSource } from "@wopal/ellamaka-cordis/plugins/installer"
import { parseProfiles, parseRegistrySpec } from "./dsh-plugin-profiles"
import { CliError, effectCmd, fail } from "../effect-cmd"

/**
 * `ellamaka dsh plugin` command group (DESIGN-dsh-poc 插件供应链, A2 retarget).
 *
 * Every subcommand is a pure disk operation writing the OFFICIAL end state:
 * the package entity lands in `<profile>/node_modules/`, the declaration in
 * the profile `package.json`, and enable/disable writes the user patch layer
 * (`cordis.patch.yml`, official patch.ts semantics). The running server
 * watches those composition files and hot-replays (D-02/D-03) — the CLI
 * never touches containers directly.
 *
 * Before any operation the legacy plugin store (if present) is migrated
 * once into the profile manifests (idempotent; the retired file is kept for
 * rollback).
 */

const RISK_NOTE =
  "Third-party dsh plugins run in the same process as Ellamaka with filesystem and shell access. Only install plugins you trust."

function dshHome(): string {
  return join(Global.Path.wopalHome, "dsh")
}

/** Map an installer/migration error to a user-visible CliError. */
function toCliError(error: unknown): CliError {
  if (error instanceof NotInstalledError) {
    return new CliError({ message: error.message })
  }
  return new CliError({ message: error instanceof Error ? error.message : String(error) })
}

/** One-time legacy-store migration hook (idempotent, runs before anything). */
async function ensureMigrated(home: string): Promise<void> {
  await migratePluginStore(home)
}

/** The profile patch file path for one profile. */
function patchPathOf(home: string, profile: string): string {
  return join(home, "home", "profiles", profile, "cordis.patch.yml")
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

    yield* Effect.tryPromise({
      try: () => ensureMigrated(home),
      catch: toCliError,
    })

    if (action === "add") {
      const profiles = parseProfiles(args.profile as string | undefined)
      if (!pkg && !args.dir) return yield* fail("dsh plugin add requires <pkg> or --dir <path>")
      if (pkg && args.dir) return yield* fail("dsh plugin add accepts either <pkg> or --dir, not both")
      if (pkg) {
        // Phase-1 transport policy: github sources get a clear error with the
        // npm alternative before any network activity (D-07).
        yield* Effect.try({
          try: () => {
            const spec = parseRegistrySpec(pkg)
            assertNotGithubSource(spec.kind === "registry" ? (spec.version ?? spec.name) : spec.name)
            return RISK_NOTE
          },
          catch: toCliError,
        })
      }
      const result = yield* Effect.tryPromise({
        try: () =>
          args.dir
            ? installPackage({ kind: "dir", path: args.dir }, { home, profiles })
            : installPackage(parseRegistrySpec(pkg!), { home, profiles }),
        catch: toCliError,
      })
      log.success(`Installed ${result.name}@${result.version} (${result.source})`)
      log.info(`Enabled in: ${profiles.join(", ")}`)
      if (result.warning) log.warn(result.warning)
      log.info("A running ellamaka server hot-mounts it via composition-file watching; otherwise it mounts at next boot.")
      return
    }

    if (action === "remove") {
      if (!pkg) return yield* fail("dsh plugin remove requires <pkg>")
      yield* Effect.tryPromise({
        try: () => removePackage(pkg, { home }),
        catch: toCliError,
      })
      log.success(`Removed ${pkg}`)
      log.info("A running ellamaka server unmounts it via composition-file watching.")
      return
    }

    if (action === "enable" || action === "disable") {
      if (!pkg) return yield* fail(`dsh plugin ${action} requires <pkg>`)
      const enabled = action === "enable"
      // enable: the requested profiles (alias-expanded). disable without
      // --profile: both built-ins; with --profile: exactly those.
      const targets = enabled
        ? parseProfiles(args.profile as string | undefined)
        : args.profile
          ? parseProfiles(args.profile as string)
          : ["web", "ellamaka-tools"]
      yield* Effect.tryPromise({
        try: async () => {
          let touched = false
          for (const profile of targets) {
            // Only a package the profile declares can flip state.
            const patchPath = patchPathOf(home, profile)
            const installed = readUserPatchState(patchPath).inserts.includes(pkg)
            if (!installed) continue
            touched = true
            if (enabled) await enableRow(patchPath, pkg)
            else await disableRow(patchPath, pkg)
          }
          if (!touched) throw new NotInstalledError(pkg)
        },
        catch: toCliError,
      })
      log.success(`${enabled ? "Enabled" : "Disabled"} ${pkg}`)
      log.info(`Enabled in: ${targets.join(", ")}`)
      return
    }

    if (action === "list") {
      const plugins = yield* Effect.try({
        try: () => listInstalled(home, parseProfiles(args.profile as string | undefined)[0] ?? "web"),
        catch: toCliError,
      })
      if (args.json) {
        process.stdout.write(JSON.stringify({ plugins }) + "\n")
        return
      }
      if (plugins.length === 0) {
        log.info("No dsh plugins installed.")
        return
      }
      for (const entry of plugins) {
        log.info(`${entry.name}@${entry.version}`)
      }
      return
    }

    return yield* fail(`unknown dsh plugin action: ${action} (expected add|remove|enable|disable|list)`)
  }),
})
