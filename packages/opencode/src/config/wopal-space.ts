import path from "path"
import { existsSync } from "fs"
import { mergeDeep } from "remeda"
import { Log } from "../util"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"
import { ConfigParse } from "./parse"
import { ConfigCommand } from "./command"
import { ConfigAgent } from "./agent"
import { ConfigPlugin } from "./plugin"
import { Effect, Exit, Fiber } from "effect"
import type { Info } from "./config"
import type { ConsoleState } from "./console-state"

const log = Log.create({ service: "config" })

export interface WopalSpaceDeps {
  findWopalDirs: (start: string, stop: string) => Effect.Effect<string[], never, never>
  installPluginDeps: (dir: string) => Effect.Effect<Fiber.Fiber<void, never>, never, never>
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
  worktree: string | undefined
}) {
  return Effect.gen(function* () {
    if (!Flag.WOPAL_SPACE || !ctx.worktree || Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
      return undefined
    }

    log.debug("wopal-space mode detection", { directory: ctx.directory, worktree: ctx.worktree })

    const wopalFound = yield* deps.findWopalDirs(ctx.directory, ctx.worktree)

    if (wopalFound.length === 0) {
      log.warn("--wopal-space enabled but no .wopal directory found between cwd and worktree")
      return undefined
    }

    const localWopalDirs = wopalFound.toReversed()
    const homeWopal = path.join(Global.Path.home, ".wopal")

    const seen = new Set<string>()
    const directories: string[] = []
    for (const d of [Global.Path.config, ...(existsSync(homeWopal) ? [homeWopal] : []), ...localWopalDirs]) {
      if (!seen.has(d)) {
        seen.add(d)
        directories.push(d)
      }
    }

    const global = yield* deps.getGlobal()
    yield* deps.merge(Global.Path.config, global, "global")

    for (const dir of localWopalDirs) {
      let loaded = false
      for (const file of ["settings.jsonc", "settings.json"]) {
        const settingsPath = path.join(dir, "config", file)
        const text = yield* deps.readConfigFile(settingsPath)
        if (text) {
          const raw = ConfigParse.jsonc(text, settingsPath) as Record<string, unknown>
          if (raw?.ellamaka && typeof raw.ellamaka === "object") {
            yield* deps.merge(
              settingsPath,
              yield* deps
                .loadConfig(JSON.stringify(raw.ellamaka), {
                  dir: path.dirname(settingsPath),
                  source: settingsPath,
                })
                .pipe(
                  Effect.catchDefect((err: unknown) => {
                    log.warn("failed to parse ellamaka config, skipping", {
                      path: settingsPath,
                      error: err instanceof Error ? err.message : String(err),
                    })
                    return Effect.succeed({} as Info)
                  }),
                ),
            )
            loaded = true
          }
        }
      }
      if (!loaded) {
        log.warn("wopal space detected but no config/settings.jsonc with ellamaka field found", { dir })
      }
    }

    deps.initContainers()

    const depFibers: Fiber.Fiber<void, never>[] = []
    for (const dir of localWopalDirs) {
      yield* deps.ensureGitignore(dir).pipe(Effect.orDie)
      depFibers.push(yield* deps.installPluginDeps(dir))
    }

    for (const dir of directories) {
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
