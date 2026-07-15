import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { localPluginInstallDeps, collectPluginDeps, hashDeps, needsPluginDepInstall, writeDirDepFingerprint } from "@/config/wopal-space"

async function makeTmpPluginDir(base: string, name: string, deps?: Record<string, string>) {
  const pkgDir = path.join(base, "plugins", name)
  const srcDir = path.join(pkgDir, "src")
  await fs.mkdir(srcDir, { recursive: true })
  await fs.writeFile(path.join(srcDir, "index.ts"), "export default {}")
  await fs.writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      ...(deps ? { dependencies: deps } : {}),
    }),
  )
  return pkgDir
}

describe("collectPluginDeps", () => {
  test("does not depend on Bun filesystem APIs used outside the Bun runtime", async () => {
    const source = await fs.readFile(new URL("../../src/config/wopal-space.ts", import.meta.url), "utf8")
    expect(source).not.toMatch(/\bBun\.(file|write)\b/)
  })

  test("flattens dependencies from multiple plugins", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      await makeTmpPluginDir(tmpBase, "plugin-a", { openai: "^6.0.0", yaml: "^2.0.0" })
      await makeTmpPluginDir(tmpBase, "plugin-b", { lodash: "^4.0.0", yaml: "^2.1.0" })

      const { deps, plugins } = await collectPluginDeps(tmpBase)

      const names = deps.map((d) => d.name).sort()
      expect(names).toEqual(["lodash", "openai", "yaml"])
      const yamlDep = deps.find((d) => d.name === "yaml")
      expect(yamlDep?.version).toMatch(/^\^2/)
      expect(Object.keys(plugins).sort()).toEqual(["plugin-a", "plugin-b"])
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("deduplicates same package across plugins (last wins)", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      await makeTmpPluginDir(tmpBase, "plugin-a", { openai: "^6.0.0" })
      await makeTmpPluginDir(tmpBase, "plugin-b", { openai: "^7.0.0" })

      const { deps } = await collectPluginDeps(tmpBase)

      expect(deps).toHaveLength(1)
      expect(deps[0].name).toBe("openai")
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("skips plugins without name field", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      const pkgDir = path.join(tmpBase, "plugins", "no-name")
      await fs.mkdir(pkgDir, { recursive: true })
      await fs.writeFile(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ dependencies: { foo: "^1.0.0" } }),
      )

      const { deps, plugins } = await collectPluginDeps(tmpBase)

      expect(deps).toEqual([])
      expect(Object.keys(plugins)).toHaveLength(0)
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("skips plugins without dependencies field", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      await makeTmpPluginDir(tmpBase, "no-deps-plugin")

      const { deps, plugins } = await collectPluginDeps(tmpBase)

      expect(deps).toEqual([])
      expect(Object.keys(plugins)).toEqual(["no-deps-plugin"])
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("returns empty when no plugins directory exists", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      const { deps, fingerprint } = await collectPluginDeps(tmpBase)
      expect(deps).toEqual([])
      expect(fingerprint).toBe(hashDeps([]))
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("scans both plugin/ and plugins/ directories", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      const pluginDir = path.join(tmpBase, "plugin", "alpha")
      const pluginsDir = path.join(tmpBase, "plugins", "beta")
      await fs.mkdir(pluginDir, { recursive: true })
      await fs.mkdir(pluginsDir, { recursive: true })
      await fs.writeFile(
        path.join(pluginDir, "package.json"),
        JSON.stringify({ name: "alpha", dependencies: { "alpha-dep": "^1.0.0" } }),
      )
      await fs.writeFile(
        path.join(pluginsDir, "package.json"),
        JSON.stringify({ name: "beta", dependencies: { "beta-dep": "^1.0.0" } }),
      )

      const { deps } = await collectPluginDeps(tmpBase)
      const names = deps.map((d) => d.name).sort()
      expect(names).toEqual(["alpha-dep", "beta-dep"])
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("fingerprint changes when deps change", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      await makeTmpPluginDir(tmpBase, "plugin-a", { openai: "^6.0.0" })
      const { fingerprint: fp1 } = await collectPluginDeps(tmpBase)

      await makeTmpPluginDir(tmpBase, "plugin-b", { lodash: "^4.0.0" })
      const { fingerprint: fp2 } = await collectPluginDeps(tmpBase)

      expect(fp1).not.toBe(fp2)
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("fingerprint is stable for same deps", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      await makeTmpPluginDir(tmpBase, "plugin-a", { openai: "^6.0.0", yaml: "^2.0.0" })
      const { fingerprint: fp1 } = await collectPluginDeps(tmpBase)
      const { fingerprint: fp2 } = await collectPluginDeps(tmpBase)
      expect(fp1).toBe(fp2)
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })
})

describe("localPluginInstallDeps (backward compat)", () => {
  test("returns flattened deps, not file: protocol", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      await makeTmpPluginDir(tmpBase, "wopal-plugin", {
        openai: "^6.33.0",
        "@lancedb/lancedb": "0.22.3",
        yaml: "^2.8.2",
      })

      const deps = await localPluginInstallDeps(tmpBase)

      expect(deps).toHaveLength(3)
      const names = deps.map((d) => d.name).sort()
      expect(names).toEqual(["@lancedb/lancedb", "openai", "yaml"])
      for (const dep of deps) {
        expect(dep.version).not.toStartWith("file:")
      }
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("returns empty for plugins without deps", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-test-"))
    try {
      await makeTmpPluginDir(tmpBase, "bare-plugin")
      const deps = await localPluginInstallDeps(tmpBase)
      expect(deps).toEqual([])
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })
})

describe("hashDeps", () => {
  test("produces consistent hash for same input", () => {
    const deps = [
      { name: "openai", version: "^6.0.0" },
      { name: "yaml", version: "^2.0.0" },
    ]
    expect(hashDeps(deps)).toBe(hashDeps(deps))
  })

  test("produces different hash for different input", () => {
    const deps1 = [{ name: "openai", version: "^6.0.0" }]
    const deps2 = [{ name: "openai", version: "^7.0.0" }]
    expect(hashDeps(deps1)).not.toBe(hashDeps(deps2))
  })

  test("order-independent", () => {
    const deps1 = [
      { name: "a", version: "1" },
      { name: "b", version: "2" },
    ]
    const deps2 = [
      { name: "b", version: "2" },
      { name: "a", version: "1" },
    ]
    expect(hashDeps(deps1)).toBe(hashDeps(deps2))
  })
})
