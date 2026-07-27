import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { existsSync } from "fs"
import {
  localPluginInstallDeps,
  collectPluginDeps,
  hashDeps,
  needsPluginDepInstall,
  writeDirDepFingerprint,
  readDepsState,
  withPluginDepInstallLock,
} from "@/config/wopal-space"

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

// --- Atomicity, corruption recovery, and per-directory install mutual exclusion ---
//
// These tests cover the robustness floor: concurrent writes must not corrupt the
// fingerprint file, a corrupted file must be backed up (not silently reset to
// empty, which would force re-install forever), and concurrent installs against
// the same directory must be serialized via a process-local lock.

describe("writeDepsState (atomic write)", () => {
  test("concurrent writes do not corrupt the file", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-atomic-"))
    const statePath = path.join(tmpBase, "plugin-deps.json")
    try {
      // 20 concurrent writes of distinct dir entries into the same file. With
      // non-atomic writeFile, interleaved O_TRUNC + partial writes produce
      // corrupted JSON. Atomic temp+rename must keep the file parseable and
      // reflect the last writer's state.
      const dirs = Array.from({ length: 20 }, (_, i) => `dir-${i}`)
      await Promise.all(
        dirs.map((dir) =>
          writeDirDepFingerprint(dir, hashDeps([{ name: `dep-${dir}`, version: "1.0.0" }]), {}, statePath),
        ),
      )

      const state = await readDepsState(statePath)
      // Every dir entry should be present and parseable; the exact count is
      // the concurrency winner set, but atomic write guarantees no partial
      // corruption. With a process-local read-modify-write lock around the
      // whole writeDirDepFingerprint, all 20 should land.
      expect(Object.keys(state.dirs).length).toBeGreaterThan(0)
      for (const dir of Object.keys(state.dirs)) {
        expect(typeof state.dirs[dir].fingerprint).toBe("string")
        expect(state.dirs[dir].fingerprint.length).toBeGreaterThan(0)
      }
      // Re-read raw text and ensure it parses (no trailing garbage).
      const raw = await fs.readFile(statePath, "utf8")
      expect(() => JSON.parse(raw)).not.toThrow()
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })
})

describe("readDepsState (corruption recovery)", () => {
  test("backs up corrupted file and returns empty state", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-corrupt-"))
    const statePath = path.join(tmpBase, "plugin-deps.json")
    try {
      // Write a corrupted file (valid JSON prefix + trailing garbage, mirroring
      // the real concurrency-corruption signature we saw in the field).
      await fs.writeFile(statePath, '{"version":1,"dirs":{}}\n} } } } } }', "utf8")

      const state = await readDepsState(statePath)
      expect(state).toEqual({ version: 1, dirs: {} })

      // The corrupted file must be backed up, not silently overwritten/deleted,
      // so users (and we) can diagnose the corruption later.
      const backups = await fs.readdir(tmpBase)
      const bakFiles = backups.filter((f) => f.startsWith("plugin-deps.json.bak."))
      expect(bakFiles.length).toBe(1)
      const bakContent = await fs.readFile(path.join(tmpBase, bakFiles[0]), "utf8")
      expect(bakContent).toContain('} } } } } }')
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })

  test("returns empty state when file does not exist (no backup created)", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-missing-"))
    const statePath = path.join(tmpBase, "plugin-deps.json")
    try {
      const state = await readDepsState(statePath)
      expect(state).toEqual({ version: 1, dirs: {} })
      // No backup file should be created for a simply-missing file.
      expect(existsSync(statePath)).toBe(false)
      const backups = (await fs.readdir(tmpBase)).filter((f) => f.startsWith("plugin-deps.json.bak."))
      expect(backups).toEqual([])
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })
})

describe("withPluginDepInstallLock (per-directory mutual exclusion)", () => {
  test("serializes concurrent installs for the same directory", async () => {
    // The lock guarantees that concurrent install attempts against the same
    // directory share a single in-flight Promise, so install runs at most once
    // per directory per process. Different directories run concurrently.
    let dirARuns = 0
    let dirBRuns = 0
    let dirAConcurrent = 0
    let dirAMaxConcurrent = 0

    const makeInstall = (dir: string, counter: () => void, trackConcurrent: () => void, releaseConcurrent: () => void) =>
      withPluginDepInstallLock(dir, async () => {
        trackConcurrent()
        counter()
        // Simulate install work overlapping in time with a concurrent caller.
        await new Promise((r) => setTimeout(r, 20))
        releaseConcurrent()
        return { ok: true as const }
      })

    // 5 concurrent installs for dir-a, 2 for dir-b
    const dirATracker = { cur: 0, max: 0 }
    const dirBTracker = { cur: 0, max: 0 }
    const dirACalls = Array.from({ length: 5 }, () =>
      makeInstall("dir-a", () => dirARuns++, () => { dirATracker.cur++; dirATracker.max = Math.max(dirATracker.max, dirATracker.cur) }, () => dirATracker.cur--),
    )
    const dirBCalls = Array.from({ length: 2 }, () =>
      makeInstall("dir-b", () => dirBRuns++, () => { dirBTracker.cur++; dirBTracker.max = Math.max(dirBTracker.max, dirBTracker.cur) }, () => dirBTracker.cur--),
    )

    const results = await Promise.all([...dirACalls, ...dirBCalls])

    // All calls resolve successfully.
    expect(results.every((r) => r.ok)).toBe(true)
    // dir-a install body ran exactly once (all 5 callers shared one Promise).
    expect(dirARuns).toBe(1)
    expect(dirBRuns).toBe(1)
    // Max concurrency inside the install body for a single dir is 1 (serialized).
    expect(dirATracker.max).toBe(1)
    expect(dirBTracker.max).toBe(1)
  })

  test("propagates install failure to all concurrent callers of the same dir", async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-deps-lockfail-"))
    try {
      const dir = path.join(tmpBase, "a")
      let runCount = 0
      const calls = Array.from({ length: 3 }, () =>
        withPluginDepInstallLock(dir, async () => {
          runCount++
          throw new Error("install failed")
        }),
      )
      const results = await Promise.allSettled(calls)
      // Body ran once; all 3 callers see the same rejection.
      expect(runCount).toBe(1)
      expect(results.every((r) => r.status === "rejected")).toBe(true)
    } finally {
      await fs.rm(tmpBase, { recursive: true, force: true })
    }
  })
})
