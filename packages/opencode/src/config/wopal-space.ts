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
import { existsSync } from "fs"
import { readFile, unlink, writeFile } from "fs/promises"

const log = Log.create({ service: "config" })

export type InstallDependency = {
  name: string
  version?: string
}

// --- Plugin dependency fingerprint ---

type PluginDepSnapshot = {
  path: string
  deps: Record<string, string>
}

type DirDepState = {
  fingerprint: string
  installed_at: number
  plugins: Record<string, PluginDepSnapshot>
}

type PluginDepsState = {
  version: 1
  dirs: Record<string, DirDepState>
}

function depsStatePath() {
  return path.join(Global.Path.state, "plugin-deps.json")
}

export function hashDeps(deps: InstallDependency[]): string {
  const str = deps.map((d) => `${d.name}@${d.version ?? ""}`).sort().join(",")
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0
  }
  return hash.toString(16)
}

async function readDepsState(): Promise<PluginDepsState> {
  return readFile(depsStatePath(), "utf8")
    .then((text) => JSON.parse(text) as PluginDepsState)
    .catch(() => ({ version: 1 as const, dirs: {} }))
}

async function writeDepsState(state: PluginDepsState): Promise<void> {
  await writeFile(depsStatePath(), JSON.stringify(state, null, 2))
}

export async function writeDirDepFingerprint(dir: string, fingerprint: string, plugins: Record<string, PluginDepSnapshot>): Promise<void> {
  const state = await readDepsState()
  state.dirs[dir] = {
    fingerprint,
    installed_at: Date.now(),
    plugins,
  }
  await writeDepsState(state)
}

export async function writeInstallManifest(dir: string, deps: InstallDependency[], extraDeps?: InstallDependency[]): Promise<void> {
  const dependencies: Record<string, string> = {}
  for (const dep of [...(extraDeps ?? []), ...deps]) {
    dependencies[dep.name] = dep.version ?? "latest"
  }
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ dependencies }, null, 2))
}

// --- Plugin dependency collection ---

export type CollectedPluginDeps = {
  deps: InstallDependency[]
  fingerprint: string
  plugins: Record<string, PluginDepSnapshot>
}

export async function collectPluginDeps(dir: string): Promise<CollectedPluginDeps> {
  const plugins: Record<string, PluginDepSnapshot> = {}
  const resolved = new Map<string, string>()

  for (const pkgPath of await Glob.scan("{plugin,plugins}/*/package.json", {
    cwd: dir,
    absolute: true,
  })) {
    const json = await readFile(pkgPath, "utf8")
      .then((text) => JSON.parse(text) as Record<string, unknown>)
      .catch(() => undefined)
    if (!json) continue
    const name = typeof json.name === "string" ? json.name.trim() : undefined
    if (!name) continue

    const deps =
      json.dependencies && typeof json.dependencies === "object" && !Array.isArray(json.dependencies)
        ? Object.fromEntries(
            Object.entries(json.dependencies).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : {}
    plugins[name] = {
      path: path.relative(dir, pkgPath),
      deps,
    }

    for (const [depName, depVersion] of Object.entries(deps)) {
      if (typeof depVersion === "string") {
        resolved.set(depName, depVersion)
      }
    }
  }

  const depsList = Array.from(resolved.entries())
    .map(([name, version]) => ({ name, version }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    deps: depsList,
    fingerprint: hashDeps(depsList),
    plugins,
  }
}

export async function localPluginInstallDeps(dir: string): Promise<InstallDependency[]> {
  const { deps } = await collectPluginDeps(dir)
  return deps
}

export async function needsPluginDepInstall(dir: string, fingerprint: string): Promise<boolean> {
  if (!existsSync(path.join(dir, "node_modules"))) return true
  const state = await readDepsState()
  const entry = state.dirs[dir]
  return !entry || entry.fingerprint !== fingerprint
}

export async function cleanPluginDepArtifacts(dir: string): Promise<void> {
  await unlink(path.join(dir, "package-lock.json")).catch(() => {})
}

export interface WopalSpaceDeps {
  installPluginDeps: (dir: string, add: InstallDependency[]) => Effect.Effect<Fiber.Fiber<void, never>, never, never>
  installPluginDepsWithFingerprint: (
    dir: string,
    add: InstallDependency[],
    fingerprint: string,
    plugins: Record<string, PluginDepSnapshot>,
  ) => Effect.Effect<Fiber.Fiber<void, never>, never, never>
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
    if (Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
      return undefined
    }

    const settings = yield* loadWopalSpaceSettingsFiles(deps, { directory: ctx.directory })
    if (!settings) {
      return undefined
    }

    log.info("wopal-space mode detected", { directory: ctx.directory })

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
    const dirsToInstall = [Global.Path.wopalHome, ...localWopalDirs].filter((d) => existsSync(d))
    for (const dir of dirsToInstall) {
      yield* deps.ensureGitignore(dir).pipe(Effect.orDie)
      const collected = yield* Effect.promise(() => collectPluginDeps(dir))
      if (collected.deps.length === 0) continue

      const needInstall = yield* Effect.promise(() => needsPluginDepInstall(dir, collected.fingerprint))
      if (!needInstall) {
        log.info("plugin deps up to date, skipping install", { dir })
        continue
      }

      yield* Effect.promise(() => cleanPluginDepArtifacts(dir))
      depFibers.push(
        yield* deps.installPluginDepsWithFingerprint(dir, collected.deps, collected.fingerprint, collected.plugins),
      )
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
