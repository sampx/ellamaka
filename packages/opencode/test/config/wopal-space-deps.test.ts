import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { localPluginInstallDeps } from "@/config/wopal-space"

describe("localPluginInstallDeps", () => {
  test("collects plugin deps from plugins/*/package.json subdirectories (Windows shim scenario)", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      // Simulate Windows layout:
      //   plugins/wopal-plugin.ts          <- shim file (re-export, 25 bytes)
      //   plugins/wopal-plugin/            <- <DIR> subdirectory
      //   plugins/wopal-plugin/package.json <- name=wopal-plugin, deps={openai, ...}
      //   plugins/wopal-plugin/src/index.ts <- actual source
      const pluginsDir = path.join(tmpBase, "plugins")
      const pkgDir = path.join(pluginsDir, "wopal-plugin")
      const srcDir = path.join(pkgDir, "src")
      const shimFile = path.join(pluginsDir, "wopal-plugin.ts")

      await fs.mkdir(srcDir, { recursive: true })
      await fs.writeFile(path.join(srcDir, "index.ts"), "export default {}")
      await fs.writeFile(shimFile, "export * from './wopal-plugin/src/index'")
      await fs.writeFile(
        path.join(pkgDir, "package.json"),
        JSON.stringify({
          name: "wopal-plugin",
          version: "1.0.0",
          dependencies: { openai: "^4.0.0", "@lancedb/lancedb": "^0.1.0" },
        }),
      )

      const deps = await localPluginInstallDeps(tmpBase)

      expect(deps).toHaveLength(1)
      expect(deps[0].name).toBe("wopal-plugin")
      expect(await fs.realpath(deps[0].version!.slice("file:".length))).toBe(await fs.realpath(pkgDir))
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("skips package.json without a name field", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      const pluginsDir = path.join(tmpBase, "plugins")
      const pkgDir = path.join(pluginsDir, "no-name-plugin")
      await fs.mkdir(pkgDir, { recursive: true })
      await fs.writeFile(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ version: "0.1.0", dependencies: { foo: "^1.0.0" } }),
      )

      const deps = await localPluginInstallDeps(tmpBase)
      expect(deps).toEqual([])
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("returns empty when plugins/ has no subdirectories", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      await fs.mkdir(path.join(tmpBase, "plugins"), { recursive: true })

      const deps = await localPluginInstallDeps(tmpBase)
      expect(deps).toEqual([])
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("ignores bare .ts files in plugins/ (only scans subdirectories)", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      const pluginsDir = path.join(tmpBase, "plugins")
      await fs.mkdir(pluginsDir, { recursive: true })
      // Bare .ts file — not a subdirectory, should be ignored
      await fs.writeFile(path.join(pluginsDir, "diag.ts"), "export default {}")

      const deps = await localPluginInstallDeps(tmpBase)
      expect(deps).toEqual([])
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("scans both plugin/ and plugins/ directories (singular form compatibility)", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      const pluginDir = path.join(tmpBase, "plugin")
      const pluginsDir = path.join(tmpBase, "plugins")
      const pkgA = path.join(pluginDir, "alpha")
      const pkgB = path.join(pluginsDir, "beta")

      await fs.mkdir(pkgA, { recursive: true })
      await fs.mkdir(pkgB, { recursive: true })
      await fs.writeFile(path.join(pkgA, "package.json"), JSON.stringify({ name: "alpha-plugin" }))
      await fs.writeFile(path.join(pkgB, "package.json"), JSON.stringify({ name: "beta-plugin" }))

      const deps = await localPluginInstallDeps(tmpBase)

      expect(deps).toHaveLength(2)
      const names = deps.map((d) => d.name).sort()
      expect(names).toEqual(["alpha-plugin", "beta-plugin"])
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("deduplicates plugins by directory", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      const pluginsDir = path.join(tmpBase, "plugins")
      const pkgDir = path.join(pluginsDir, "bar-plugin")
      await fs.mkdir(pkgDir, { recursive: true })
      await fs.writeFile(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ name: "bar-plugin", version: "0.2.0" }),
      )

      const deps = await localPluginInstallDeps(tmpBase)

      expect(deps).toHaveLength(1)
      expect(deps[0].name).toBe("bar-plugin")
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("returns empty when no plugin or plugins directory exists", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      const deps = await localPluginInstallDeps(tmpBase)
      expect(deps).toEqual([])
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })
})
