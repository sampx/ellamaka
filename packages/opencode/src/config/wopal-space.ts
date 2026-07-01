import path from "path"
import { mergeDeep } from "remeda"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"
import { ConfigParse } from "./parse"
import { ConfigCommand } from "./command"
import { ConfigAgent } from "./agent"
import { Glob } from "@opencode-ai/core/util/glob"
import { ConfigPlugin } from "./plugin"
import { loadWopalSpaceSettingsFiles } from "./wopal-space-settings"
import { Effect, Exit, Fiber } from "effect"
import type { Info } from "./config"
import type { ConsoleState } from "./console-state"

const log = Log.create({ service: "config" })

export type InstallDependency = {
  name: string
  version?: string
}

async function scanPluginPackages(dir: string): Promise<{ dir: string; name: string }[]> {
  const seen = new Set<string>()
  const result: { dir: string; name: string }[] = []

  for (const pkgPath of await Glob.scan("{plugin,plugins}/*/package.json", {
    cwd: dir,
    absolute: true,
  })) {
    const pkgDir = path.dirname(pkgPath)
    if (seen.has(pkgDir)) continue
    seen.add(pkgDir)

    const json = await Bun.file(pkgPath).json().catch(() => undefined)
    const name = typeof json?.name === "string" ? json.name.trim() : undefined
    if (!name) continue

    result.push({ dir: pkgDir, name })
  }

  return result
}

export async function localPluginInstallDeps(dir: string): Promise<InstallDependency[]> {
  const packages = await scanPluginPackages(dir)
  return packages
    .toSorted((a, b) => a.dir.localeCompare(b.dir))
    .map(({ dir, name }) => ({ name, version: `file:${dir}` }))
}

export interface WopalSpaceDeps {
  installPluginDeps: (dir: string, add: InstallDependency[]) => Effect.Effect<Fiber.Fiber<void, never>, never, never>
  readConfigFile: (filepath: string) => Effect.Effect<string | undefined, never, never>
  loadConfig: (
    text: string,
    options: { path: string } | { dir: string; source: string },
  ) => Effect.Effect<Info, never, never>
  getGlobal: () => Effect.Effect<Info, never, never>
  merge: (source: string, next: Info, kind?: ConfigPlugin.Scope) => Effect.Effect<void, never, never>
  mergePluginOrigins: (
    source: string,
    list: ConfigPlugin.Spec[] | undefined,
    kind?: ConfigPlugin.Scope,
  ) => Effect.Effect<void, never, never>
  ensureGitignore: (dir: string) => Effect.Effect<void, never, never>
  applyPostMerge: () => void
  initContainers: () => void
  getResult: () => Info
}

export interface WopalSpaceResult {
  config: Info
  directories: string[]
  deps: Fiber.Fiber<void, never>[]
  consoleState: ConsoleState
}

export function tryLoadWopalSpaceConfig(deps: WopalSpaceDeps, ctx: {
  directory: string
}) {
  return Effect.gen(function* () {
    if (!Flag.WOPAL_SPACE || Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
      return undefined
    }

    log.info("wopal-space mode detected", { directory: ctx.directory })

    const settings = yield* loadWopalSpaceSettingsFiles(deps, { directory: ctx.directory })
    if (!settings) {
      return undefined
    }

    const directories = settings.directories
    const localWopalDirs = settings.localWopalDirs

    const global = yield* deps.getGlobal()
    yield* deps.merge(Global.Path.config, global, "global")

    for (const dir of localWopalDirs) {
      let loaded = false
      for (const file of settings.files) {
        if (file.dir !== dir) continue
        const raw = ConfigParse.jsonc(file.text, file.path) as Record<string, unknown>
        if (raw?.ellamaka && typeof raw.ellamaka === "object") {
          yield* deps.merge(
            file.path,
            yield* deps
              .loadConfig(JSON.stringify(raw.ellamaka), {
                dir: path.dirname(file.path),
                source: file.path,
              })
              .pipe(
                Effect.catchDefect((err: unknown) => {
                  log.warn("failed to parse ellamaka config, skipping", {
                    path: file.path,
                    error: err instanceof Error ? err.message : String(err),
                  })
                  return Effect.succeed({} as Info)
                }),
              ),
          )
          loaded = true
          log.info("loaded ellamaka config", { path: file.path })
        }
      }
      if (!loaded) {
        log.warn("wopal space detected but no settings.jsonc or settings.local.jsonc with ellamaka field found", { dir })
      }
    }

    deps.initContainers()

    const depFibers: Fiber.Fiber<void, never>[] = []
    for (const dir of localWopalDirs) {
      yield* deps.ensureGitignore(dir).pipe(Effect.orDie)
      depFibers.push(yield* deps.installPluginDeps(dir, yield* Effect.promise(() => localPluginInstallDeps(dir))))
    }

    for (const dir of directories) {
      if (dir === Global.Path.config) continue
      yield* deps.merge(dir, {
        command: yield* Effect.promise(() => ConfigCommand.load(dir)),
        agent: mergeDeep(
          mergeDeep({}, yield* Effect.promise(() => ConfigAgent.load(dir))),
          yield* Effect.promise(() => ConfigAgent.loadMode(dir)),
        ),
      } as Info)
      if (!Flag.OPENCODE_PURE) {
        const list = yield* Effect.promise(() => ConfigPlugin.load(dir))
        yield* deps.mergePluginOrigins(dir, list)
      }
    }

    if (process.env.OPENCODE_CONFIG_CONTENT) {
      const source = "OPENCODE_CONFIG_CONTENT"
      const next = yield* deps.loadConfig(process.env.OPENCODE_CONFIG_CONTENT, {
        dir: ctx.directory,
        source,
      })
      yield* deps.merge(source, next, "local")
      log.debug("loaded custom config from OPENCODE_CONFIG_CONTENT")
    }

    deps.applyPostMerge()

    return {
      config: deps.getResult(),
      directories,
      deps: depFibers,
      consoleState: {
        consoleManagedProviders: [],
        activeOrgName: undefined,
        switchableOrgCount: 0,
      },
    } satisfies WopalSpaceResult
  })
}

export * as ConfigWopalSpace from "./wopal-space"
