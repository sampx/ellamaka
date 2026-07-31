import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { loadWopalSpaceSettingsFiles, resolveWopalSpaceRoot } from "@/config/wopal-space-settings"
import { tmpdir } from "../fixture/fixture"

const deps = { readConfigFile: (_filepath: string) => Effect.succeed(undefined) }

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
