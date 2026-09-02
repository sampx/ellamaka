import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  PLUGINS_DIR,
  STORE_FILENAME,
  readStore,
  setEnabled,
  updateStore,
  writeStore,
  type DshPluginStoreV1,
} from "../src/plugins/store"
import { setEnabled as setEnabledPure } from "../src/plugins/store"


function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "dsh-plugin-store-"))
}

function seedStoreFile(home: string, content: string): void {
  const dir = join(home, PLUGINS_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, STORE_FILENAME), content)
}

describe("dsh plugin store", () => {
  test("readStore on a fresh dir returns an empty store", () => {
    const home = tempHome()
    const store = readStore(home)
    expect(store).toEqual({ schema: "ellamaka.dsh-plugins/v1", plugins: [] })
  })

  test("readStore rejects a store with a foreign schema", () => {
    const home = tempHome()
    seedStoreFile(home, JSON.stringify({ schema: "someone.else/v9", plugins: [] }))
    expect(() => readStore(home)).toThrow(/schema/)
  })

  test("readStore rejects a non-array plugins field", () => {
    const home = tempHome()
    seedStoreFile(home, JSON.stringify({ schema: "ellamaka.dsh-plugins/v1", plugins: {} }))
    expect(() => readStore(home)).toThrow(/plugins/)
  })

  test("readStore rejects malformed JSON", () => {
    const home = tempHome()
    seedStoreFile(home, "{not json")
    expect(() => readStore(home)).toThrow()
  })

  test("writeStore atomically writes the store without leaving tmp files", async () => {
    const home = tempHome()
    const store: DshPluginStoreV1 = {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "fixture", version: "1.0.0", source: "dir", enabledIn: ["web"], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    }
    await writeStore(home, store)
    const pluginsDir = join(home, PLUGINS_DIR)
    const raw = JSON.parse(readFileSync(join(pluginsDir, STORE_FILENAME), "utf-8"))
    expect(raw).toEqual(store)
    // tmp siblings were cleaned up (only the store file remains)
    const leftovers = readdirSync(pluginsDir).filter((f) => f !== STORE_FILENAME)
    expect(leftovers).toEqual([])
  })

  test("writeStore rejects an invalid store and writes nothing", async () => {
    const home = tempHome()
    await expect(
      writeStore(home, { plugins: [] } as unknown as DshPluginStoreV1),
    ).rejects.toThrow(/schema/)
    await expect(
      writeStore(home, { schema: "ellamaka.dsh-plugins/v1" } as unknown as DshPluginStoreV1),
    ).rejects.toThrow(/plugins/)
    expect(existsSync(join(home, PLUGINS_DIR, STORE_FILENAME))).toBe(false)
  })

  test("setEnabled enable adds the profile idempotently", () => {
    const store: DshPluginStoreV1 = {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "a", version: "1.0.0", source: "dir", enabledIn: ["web"], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    }
    const once = setEnabled(store, "a", "ellamaka-tools", true)
    expect(once.plugins[0].enabledIn).toEqual(["web", "ellamaka-tools"])
    const twice = setEnabled(once, "a", "ellamaka-tools", true)
    expect(twice.plugins[0].enabledIn).toEqual(["web", "ellamaka-tools"])
  })

  test("setEnabled disable removes the profile and tolerates a missing one", () => {
    const store: DshPluginStoreV1 = {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "a", version: "1.0.0", source: "dir", enabledIn: ["web", "ellamaka-tools"], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    }
    const off = setEnabled(store, "a", "web", false)
    expect(off.plugins[0].enabledIn).toEqual(["ellamaka-tools"])
    const offAgain = setEnabled(off, "a", "web", false)
    expect(offAgain.plugins[0].enabledIn).toEqual(["ellamaka-tools"])
  })

  test("setEnabled throws for an unknown plugin name", () => {
    const store: DshPluginStoreV1 = { schema: "ellamaka.dsh-plugins/v1", plugins: [] }
    expect(() => setEnabled(store, "ghost", "web", true)).toThrow(/ghost/)
  })

  test("updateStore performs a locked read-modify-write", async () => {
    const home = tempHome()
    await writeStore(home, { schema: "ellamaka.dsh-plugins/v1", plugins: [] })
    const result = await updateStore(home, (store) => {
      store.plugins.push({
        name: "in-place",
        version: "0.1.0",
        source: "dir",
        enabledIn: [],
        installedAt: "2026-09-02T00:00:00.000Z",
      })
      return { result: store.plugins.length, store }
    })
    expect(result).toBe(1)
    expect(readStore(home).plugins.map((p) => p.name)).toEqual(["in-place"])
  })

  test("updateStore leaves the store untouched when the mutator throws", async () => {
    const home = tempHome()
    await writeStore(home, { schema: "ellamaka.dsh-plugins/v1", plugins: [] })
    await expect(
      updateStore(home, () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(readStore(home).plugins).toEqual([])
  })

  test("concurrent updateStore calls serialize and keep every mutation", async () => {
    const home = tempHome()
    await writeStore(home, { schema: "ellamaka.dsh-plugins/v1", plugins: [] })
    const names = ["p1", "p2", "p3", "p4", "p5"]
    await Promise.all(
      names.map((name) =>
        updateStore(home, (store) => {
          store.plugins.push({ name, version: "1.0.0", source: "dir", enabledIn: [], installedAt: "2026-09-02T00:00:00.000Z" })
          return { result: undefined, store }
        }),
      ),
    )
    const installed = readStore(home).plugins.map((p) => p.name).sort()
    expect(installed).toEqual(["p1", "p2", "p3", "p4", "p5"])
  })

  test("interleaved enable/disable across simulated processes keeps BOTH flips (rook B-04)", async () => {
    // The CLI read happens inside the lock via updateStore: two processes that
    // each read-then-write must not drop the other's mutation. Simulate the
    // interleaving the OLD read-outside-lock code allowed by driving two
    // updateStore calls that each read a snapshot BEFORE mutating.
    const home = tempHome()
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "shared", version: "1.0.0", source: "dir", enabledIn: [], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    })
    await Promise.all([
      updateStore(home, (store) => {
        setEnabled(store, "shared", "web", true)
        return { result: undefined, store }
      }),
      updateStore(home, (store) => {
        setEnabled(store, "shared", "ellamaka-tools", true)
        return { result: undefined, store }
      }),
    ])
    const enabledIn = readStore(home).plugins[0].enabledIn.sort()
    expect(enabledIn).toEqual(["ellamaka-tools", "web"])
  })
})
