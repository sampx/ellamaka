import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { loadWopalSpaceSettingsFiles, resolveWopalSpaceRoot } from "@/config/wopal-space-settings"
import { tmpdir } from "../fixture/fixture"
import { tryLoadWopalSpaceConfig } from "@/config/wopal-space"
import type { WopalSpaceDeps } from "@/config/wopal-space"
import type { Info } from "@/config/config"

const deps = { readConfigFile: (_filepath: string) => Effect.succeed(undefined) }

describe("WopalSpace config injection", () => {
  // Real disk-backed settings loading: readConfigFile reads the actual file,
  // loadConfig parses the ellamaka field JSON, and merge applies later-source
  // values into the same result object the injection guard inspects.
  function createMockDeps(): WopalSpaceDeps {
    const result: Partial<Info> = {}
    return {
      installPluginDeps: () => Effect.succeed(undefined as any),
      installPluginDepsWithFingerprint: () => Effect.succeed(undefined as any),
      readConfigFile: (filepath) =>
        Effect.promise(() => fs.readFile(filepath, "utf8").catch(() => undefined)),
      loadConfig: (text) => Effect.succeed(JSON.parse(text) as Info),
      getGlobal: () => Effect.succeed({} as Info),
      merge: (_source, next) => {
        if (next.snapshot !== undefined) result.snapshot = next.snapshot
        return Effect.succeed(undefined)
      },
      mergePluginOrigins: () => Effect.succeed(undefined),
      ensureGitignore: () => Effect.succeed(undefined),
      applyPostMerge: () => {},
      initContainers: () => {},
      getResult: () => result as Info,
    }
  }

  test("snapshot defaults to false in wopal-space mode when undefined", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".wopal", "config"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, ".wopal", ".git"), "")
    await fs.writeFile(path.join(tmp.path, ".wopal", "config", "settings.jsonc"), JSON.stringify({ ellamaka: {} }))

    const result = await Effect.runPromise(tryLoadWopalSpaceConfig(createMockDeps(), { directory: tmp.path }))
    expect(result?.config.snapshot).toBe(false)
  })

  test("explicit snapshot true in space settings survives the injection guard", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".wopal", "config"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, ".wopal", ".git"), "")
    await fs.writeFile(path.join(tmp.path, ".wopal", "config", "settings.jsonc"), JSON.stringify({ ellamaka: { snapshot: true } }))

    const result = await Effect.runPromise(tryLoadWopalSpaceConfig(createMockDeps(), { directory: tmp.path }))
    expect(result?.config.snapshot).toBe(true)
  })

  test("explicit snapshot false in space settings is preserved", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".wopal", "config"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, ".wopal", ".git"), "")
    await fs.writeFile(path.join(tmp.path, ".wopal", "config", "settings.jsonc"), JSON.stringify({ ellamaka: { snapshot: false } }))

    const result = await Effect.runPromise(tryLoadWopalSpaceConfig(createMockDeps(), { directory: tmp.path }))
    expect(result?.config.snapshot).toBe(false)
  })

  test("non-space mode returns undefined and never injects defaults", async () => {
    await using tmp = await tmpdir()
    const result = await Effect.runPromise(tryLoadWopalSpaceConfig(createMockDeps(), { directory: tmp.path }))
    expect(result).toBeUndefined()
  })
})

describe("WopalSpace instance context", () => {
  test("ignores process env for a non-space directory", async () => {
    await using tmp = await tmpdir()
    const beforeSpace = process.env.WOPAL_SPACE
    const beforeRoot = process.env.WOPAL_SPACE_ROOT
    process.env.WOPAL_SPACE = "1"
    process.env.WOPAL_SPACE_ROOT = "/tmp/other-space"
    try {
      expect(await Effect.runPromise(loadWopalSpaceSettingsFiles(deps, { directory: tmp.path }))).toBeUndefined()
    } finally {
      if (beforeSpace === undefined) delete process.env.WOPAL_SPACE
      else process.env.WOPAL_SPACE = beforeSpace
      if (beforeRoot === undefined) delete process.env.WOPAL_SPACE_ROOT
      else process.env.WOPAL_SPACE_ROOT = beforeRoot
    }
  })

  test("resolves root and subdirectory without changing process env", async () => {
    await using tmp = await tmpdir()
    const subdir = path.join(tmp.path, "projects", "app")
    await fs.mkdir(path.join(tmp.path, ".wopal"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, ".wopal", ".git"), "")
    await fs.mkdir(subdir, { recursive: true })
    const beforeSpace = process.env.WOPAL_SPACE
    const beforeRoot = process.env.WOPAL_SPACE_ROOT
    expect(resolveWopalSpaceRoot(tmp.path)).toBe(tmp.path)
    expect(resolveWopalSpaceRoot(subdir)).toBe(tmp.path)
    const result = await Effect.runPromise(loadWopalSpaceSettingsFiles(deps, { directory: subdir }))
    expect(result?.localWopalDirs).toEqual([path.join(tmp.path, ".wopal")])
    expect(process.env.WOPAL_SPACE).toBe(beforeSpace)
    expect(process.env.WOPAL_SPACE_ROOT).toBe(beforeRoot)
  })
})
