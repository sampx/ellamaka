export * as TuiConfig from "./tui"

import z from "zod"
import { mergeDeep, unique } from "remeda"
import { Context, Effect, Fiber, Layer } from "effect"
import { ConfigParse } from "@/config/parse"
import * as ConfigPaths from "@/config/paths"
import { migrateTuiConfig } from "./tui-migrate"
import { TuiInfo } from "./tui-schema"
import { Flag } from "@opencode-ai/core/flag/flag"
import { isRecord } from "@/util/record"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CurrentWorkingDirectory } from "./cwd"
import { ConfigPlugin } from "@/config/plugin"
import { ConfigKeybinds } from "@/config/keybinds"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { Filesystem } from "@/util/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { ConfigVariable } from "@/config/variable"
import { Npm } from "@opencode-ai/core/npm"
import { tryLoadWopalSpaceTuiConfig } from "./wopal-space"

const log = Log.create({ service: "tui.config" })

export const Info = TuiInfo

type Acc = {
  result: Info
}

type State = {
  config: Info
  deps: Array<Fiber.Fiber<void, AppFileSystem.Error>>
}

export type Info = z.output<typeof Info> & {
  // Internal resolved plugin list used by runtime loading.
  plugin_origins?: ConfigPlugin.Origin[]
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TuiConfig") {}

function pluginScope(file: string, ctx: { directory: string }): ConfigPlugin.Scope {
  if (Filesystem.contains(ctx.directory, file)) return "local"
  // if (ctx.worktree !== "/" && Filesystem.contains(ctx.worktree, file)) return "local"
  return "global"
}

function normalize(raw: Record<string, unknown>) {
  const data = { ...raw }
  if (!("tui" in data)) return data
  if (!isRecord(data.tui)) {
    delete data.tui
    return data
  }

  const tui = data.tui
  delete data.tui
  return {
    ...tui,
    ...data,
  }
}

const loadState = Effect.fn("TuiConfig.loadState")(function* (ctx: { directory: string }) {
  const afs = yield* AppFileSystem.Service
  const acc: Acc = {
    result: {},
  }

  const resolvePlugins = (config: Info, configFilepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      const plugins = config.plugin
      if (!plugins) return config
      for (let i = 0; i < plugins.length; i++) {
        plugins[i] = yield* Effect.promise(() => ConfigPlugin.resolvePluginSpec(plugins[i], configFilepath))
      }
      return config
    })

  const load = (text: string, configFilepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute({ text, type: "path", path: configFilepath, missing: "empty" }),
      )
      const data = ConfigParse.jsonc(expanded, configFilepath)
      if (!isRecord(data)) return {} as Info
      // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
      // (mirroring the old opencode.json shape) still get their settings applied.
      const validated = ConfigParse.schema(Info, normalize(data), configFilepath)
      return yield* resolvePlugins(validated, configFilepath)
    }).pipe(
      // catchCause (not tapErrorCause + orElseSucceed) because ConfigParse.jsonc/.schema
      // can sync-throw — those become defects, which orElseSucceed wouldn't catch.
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          log.warn("invalid tui config", { path: configFilepath, cause })
          return {} as Info
        }),
      ),
    )

  const readConfigFile = (filepath: string): Effect.Effect<string | undefined> =>
    Effect.gen(function* () {
      return yield* afs.readFileStringSafe(filepath).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            log.warn("failed to read tui config", { path: filepath, cause })
            return undefined
          }),
        ),
      )
    })

  const loadFile = (filepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      const text = yield* readConfigFile(filepath)
      if (!text) return {} as Info
      return yield* load(text, filepath)
    })

  const merge = (source: string, data: Info) =>
    Effect.sync(() => {
      acc.result = mergeDeep(acc.result, data)
      if (!data.plugin?.length) return

      const scope = pluginScope(source, ctx)
      const plugins = ConfigPlugin.deduplicatePluginOrigins([
        ...(acc.result.plugin_origins ?? []),
        ...data.plugin.map((spec) => ({ spec, scope, source })),
      ])
      acc.result.plugin = plugins.map((item) => item.spec)
      acc.result.plugin_origins = plugins
    })

  const mergeFile = (file: string) =>
    Effect.gen(function* () {
      const data = yield* loadFile(file)
      yield* merge(file, data)
    })

  // Every config dir we may read from: global config dir, any `.opencode`
  // folders between cwd and home, and OPENCODE_CONFIG_DIR.
  const directories = yield* ConfigPaths.directories(ctx.directory)
  const tuiDirectories = Flag.WOPAL_SPACE
    ? directories.filter((dir) => !dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR)
    : directories
  yield* Effect.promise(() => migrateTuiConfig({ directories: tuiDirectories, cwd: ctx.directory }))

  const projectFiles = Flag.OPENCODE_DISABLE_PROJECT_CONFIG ? [] : yield* ConfigPaths.files("tui", ctx.directory)

  // 1. Global tui config (lowest precedence).
  for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
    yield* mergeFile(file)
  }

  // 2. Explicit OPENCODE_TUI_CONFIG override, if set.
  if (Flag.OPENCODE_TUI_CONFIG) {
    const configFile = Flag.OPENCODE_TUI_CONFIG
    yield* mergeFile(configFile)
    log.debug("loaded custom tui config", { path: configFile })
  }

  // 3. Project tui files, applied root-first so the closest file wins.
  for (const file of projectFiles) {
    yield* mergeFile(file)
  }

  // 4. `.opencode` directories (and OPENCODE_CONFIG_DIR) discovered while
  // walking up the tree. Also returned below so callers can install plugin
  // dependencies from each location.
  const opencodeDirs = unique(tuiDirectories).filter((dir) => dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR)
  const wopal = Flag.WOPAL_SPACE
    ? yield* tryLoadWopalSpaceTuiConfig(
        {
          findWopalDirs: (start, stop) =>
            afs.up({ targets: [".wopal"], start, stop }).pipe(Effect.catch(() => Effect.succeed([] as string[]))),
          readConfigFile,
          loadConfig: load,
          merge,
        },
        ctx,
      )
    : undefined

  if (!Flag.WOPAL_SPACE) {
    for (const dir of opencodeDirs) {
      if (!dir.endsWith(".opencode") && dir !== Flag.OPENCODE_CONFIG_DIR) continue
      for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
        yield* mergeFile(file)
      }
    }
  }

  const dirs = wopal?.dirs ?? opencodeDirs

  const keybinds = { ...(acc.result.keybinds ?? {}) }
  if (process.platform === "win32") {
    // Native Windows terminals do not support POSIX suspend, so prefer prompt undo.
    keybinds.terminal_suspend = "none"
    keybinds.input_undo ??= unique([
      "ctrl+z",
      ...ConfigKeybinds.Keybinds.shape.input_undo.parse(undefined).split(","),
    ]).join(",")
  }
  acc.result.keybinds = ConfigKeybinds.Keybinds.parse(keybinds)

  return {
    config: acc.result,
    dirs: acc.result.plugin?.length ? dirs : [],
  }
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const directory = yield* CurrentWorkingDirectory
    const npm = yield* Npm.Service
    const data = yield* loadState({ directory })
    const deps = yield* Effect.forEach(
      data.dirs,
      (dir) =>
        npm
          .install(dir, {
            add: [
              {
                name: "@opencode-ai/plugin",
                version: InstallationLocal ? undefined : InstallationVersion,
              },
            ],
          })
          .pipe(Effect.forkScoped),
      {
        concurrency: "unbounded",
      },
    )

    const get = Effect.fn("TuiConfig.get")(() => Effect.succeed(data.config))

    const waitForDependencies = Effect.fn("TuiConfig.waitForDependencies")(() =>
      Effect.forEach(deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.ignore(), Effect.asVoid),
    )
    return Service.of({ get, waitForDependencies })
  }).pipe(Effect.withSpan("TuiConfig.layer")),
)

export const defaultLayer = layer.pipe(Layer.provide(Npm.defaultLayer), Layer.provide(AppFileSystem.defaultLayer))

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function waitForDependencies() {
  await runPromise((svc) => svc.waitForDependencies())
}

export async function get() {
  return runPromise((svc) => svc.get())
}
