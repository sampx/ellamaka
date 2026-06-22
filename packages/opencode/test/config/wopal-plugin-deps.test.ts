import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { localPluginInstallDeps } from "@/config/wopal-space"

describe("localPluginInstallDeps", () => {
  test("collects local plugin dependencies as file: entries", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      // Simulate the real $WOPAL_HOME/plugins layout:
      //   plugins/foo-plugin/             <- package dir (has package.json)
      //   plugins/foo-plugin/src/index.ts <- actual source
      //   plugins/foo.ts                  <- symlink to src/index.ts (discovered by ConfigPlugin.load)
      const pluginsDir = path.join(tmpBase, "plugins")
      const pkgDir = path.join(pluginsDir, "foo-plugin")
      const srcDir = path.join(pkgDir, "src")
      const entrySrc = path.join(srcDir, "index.ts")
      const symlink = path.join(pluginsDir, "foo.ts")

      await fs.mkdir(srcDir, { recursive: true })
      await fs.writeFile(entrySrc, "export default {}")
      await fs.symlink(entrySrc, symlink)
      await fs.writeFile(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ name: "foo-plugin", version: "0.1.0", main: "dist/index.js" }),
      )

      const deps = await localPluginInstallDeps(tmpBase)

      expect(deps).toHaveLength(1)
      expect(deps[0].name).toBe("foo-plugin")
      // Use realpath to normalize macOS /var ↔ /private/var symlink prefix
      expect(await fs.realpath(deps[0].version!.slice("file:".length))).toBe(await fs.realpath(pkgDir))
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("returns empty when no local plugins exist", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      const deps = await localPluginInstallDeps(tmpBase)
      expect(deps).toEqual([])
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("deduplicates plugins sharing the same package directory", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      const pluginsDir = path.join(tmpBase, "plugins")
      const pkgDir = path.join(pluginsDir, "bar-plugin")
      const srcDir = path.join(pkgDir, "src")
      await fs.mkdir(srcDir, { recursive: true })

      // Two symlinked .ts entry points in the same package dir
      const entry1 = path.join(srcDir, "index.ts")
      const entry2 = path.join(srcDir, "extra.ts")
      await fs.writeFile(entry1, "export default {}")
      await fs.writeFile(entry2, "export default {}")
      await fs.symlink(entry1, path.join(pluginsDir, "bar.ts"))
      await fs.symlink(entry2, path.join(pluginsDir, "bar-extra.ts"))
      await fs.writeFile(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ name: "bar-plugin", version: "0.2.0" }),
      )

      const deps = await localPluginInstallDeps(tmpBase)

      // Only one entry because both specs resolve to the same package dir
      expect(deps).toHaveLength(1)
      expect(deps[0].name).toBe("bar-plugin")
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })
})