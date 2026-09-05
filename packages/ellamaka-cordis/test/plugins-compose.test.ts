import { describe, expect, test } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context } from "@deepseek-ai/cordis"
import { mountDshTools } from "../src/dsh-web"
import { startDshPluginService } from "../src/plugins/runtime"
import { readStore } from "../src/plugins/store"
import {
  composeFullPatchStack,
  composePluginLayers,
  PLUGIN_ENTRY_ID_PREFIX,
  PLUGIN_LAYER_DIRNAME,
  healPluginsModuleFallback,
  type PluginLayerPatch,
} from "../src/plugins/compose"
import { resolveComposedRows } from "../src/plugins/resolve-specifiers"
import { writeStore } from "../src/plugins/store"

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "dsh-plugin-compose-"))
}

/** Poll a probe until it satisfies `want` (bun lacks expect.poll). */
async function waitFor(probe: () => number, want: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (probe() >= want) return
    if (Date.now() > deadline) throw new Error(`waitFor(${want}) timed out; last value: ${probe()}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** A fixture plugin package under the install area (as the installer lands it). */
function installedPlugin(home: string, name: string, version = "1.0.0", marker = "m"): string {
  const dir = join(home, "plugins", name, version)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version, type: "module", main: "index.js" }))
  writeFileSync(
    join(dir, "index.js"),
    `export const name = ${JSON.stringify(name)}\nexport function apply(ctx) { ctx.provide(${JSON.stringify(name + ".marker")}, ${JSON.stringify(marker)}) }\n`,
  )
  return dir
}

describe("composePluginLayers", () => {
  test("an empty store composes no layers", async () => {
    const home = tempHome()
    expect(composePluginLayers(home, "web")).toEqual([])
  })

  test("a missing plugins dir composes no layers (fresh home)", async () => {
    const home = tempHome()
    expect(composePluginLayers(home, "ellamaka-tools")).toEqual([])
  })

  test("only plugins enabled in the requested profile compose a layer", async () => {
    const home = tempHome()
    installedPlugin(home, "web-only", "1.0.0", "w")
    installedPlugin(home, "tools-only", "2.0.0", "t")
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "web-only", version: "1.0.0", source: "dir", enabledIn: ["web"], installedAt: "2026-09-02T00:00:00.000Z" },
        { name: "tools-only", version: "2.0.0", source: "dir", enabledIn: ["ellamaka-tools"], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    })
    healPluginsModuleFallback(home)
    const webLayers = composePluginLayers(home, "web")
    expect(webLayers).toHaveLength(1)
    expect(webLayers[0].id).toBe("dsh-plugin:web-only")
    // The bare name resolves at the composition point (B1 拆雷) to the
    // plugin's entry file: an absolute URL whose realpath is the install area
    // (require.resolve returns the healed symlink's target).
    expect(webLayers[0].name.startsWith("file://")).toBe(true)
    expect(decodeURIComponent(webLayers[0].name)).toContain(join("plugins", "web-only", "1.0.0"))

    const toolsLayers = composePluginLayers(home, "ellamaka-tools")
    expect(toolsLayers).toHaveLength(1)
    expect(toolsLayers[0].id).toBe("dsh-plugin:tools-only")
  })

  test("layers follow store order and carry explicit stable ids", async () => {
    const home = tempHome()
    installedPlugin(home, "alpha", "1.0.0")
    installedPlugin(home, "beta", "1.0.0")
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "beta", version: "1.0.0", source: "dir", enabledIn: ["web"], installedAt: "2026-09-02T00:00:00.000Z" },
        { name: "alpha", version: "1.0.0", source: "dir", enabledIn: ["web"], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    })
    healPluginsModuleFallback(home)
    const layers = composePluginLayers(home, "web")
    expect(layers.map((l) => l.id)).toEqual(["dsh-plugin:beta", "dsh-plugin:alpha"])
  })

  test("the layer row keeps the explicit id while the name resolves to the plugin entry file", async () => {
    const home = tempHome()
    installedPlugin(home, "scoped-plugin", "0.1.0")
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "scoped-plugin", version: "0.1.0", source: "dir", enabledIn: ["web"], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    })
    healPluginsModuleFallback(home)
    const layers = composePluginLayers(home, "web")
    expect(layers[0].name.startsWith("file://")).toBe(true)
    // require.resolve returns the healed symlink's realpath (the install area).
    expect(decodeURIComponent(layers[0].name)).toContain(join("plugins", "scoped-plugin", "0.1.0"))
    expect(PLUGIN_LAYER_DIRNAME).toBe("plugins")
  })
})

describe("healPluginsModuleFallback", () => {
  test("symlinks every installed plugin under profiles/node_modules", async () => {
    const home = tempHome()
    const dir = installedPlugin(home, "link-me", "3.1.0")
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "link-me", version: "3.1.0", source: "dir", enabledIn: [], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    })
    healPluginsModuleFallback(home)
    const link = join(home, "home", "profiles", "node_modules", "link-me")
    expect(existsSync(link)).toBe(true)
    expect(realpathSync(link)).toBe(realpathSync(dir))
  })

  test("re-points a stale link when the plugin is reinstalled elsewhere", async () => {
    const home = tempHome()
    const oldDir = installedPlugin(home, "mover", "1.0.0")
    const newDir = installedPlugin(home, "mover", "2.0.0")
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "mover", version: "2.0.0", source: "dir", enabledIn: [], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    })
    // Seed a stale link pointing at the old version.
    const modulesDir = join(home, "home", "profiles", "node_modules")
    mkdirSync(modulesDir, { recursive: true })
    symlinkSync(oldDir, join(modulesDir, "mover"), "dir")
    healPluginsModuleFallback(home)
    expect(realpathSync(join(modulesDir, "mover"))).toBe(realpathSync(newDir))
  })

  test("replaces a DANGLING self-owned link (rook B-06)", async () => {
    const home = tempHome()
    const dir = installedPlugin(home, "resurrected", "1.0.0")
    // Seed a link whose target no longer exists: realpathSync fails on it,
    // and a naive symlinkSync would fail EEXIST.
    const modulesDir = join(home, "home", "profiles", "node_modules")
    mkdirSync(modulesDir, { recursive: true })
    symlinkSync(join(home, "gone-plugin-dir"), join(modulesDir, "resurrected"), "dir")
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "resurrected", version: "1.0.0", source: "dir", enabledIn: [], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    })
    healPluginsModuleFallback(home)
    expect(realpathSync(join(modulesDir, "resurrected"))).toBe(realpathSync(dir))
  })

  test("keeps non-plugin entries already present in profiles/node_modules", async () => {
    const home = tempHome()
    const modulesDir = join(home, "home", "profiles", "node_modules")
    mkdirSync(modulesDir, { recursive: true })
    const foreign = join(home, "elsewhere")
    mkdirSync(foreign)
    symlinkSync(foreign, join(modulesDir, "official-pkg"), "dir")
    await writeStore(home, { schema: "ellamaka.dsh-plugins/v1", plugins: [] })
    healPluginsModuleFallback(home)
    // The foreign link is untouched and still resolves.
    expect(realpathSync(join(modulesDir, "official-pkg"))).toBe(realpathSync(foreign))
  })

  test("reads the store through the standard layout even after an unrelated file exists", async () => {
    const home = tempHome()
    installedPlugin(home, "plain", "1.0.0")
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "plain", version: "1.0.0", source: "dir", enabledIn: [], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    })
    writeFileSync(join(home, "unrelated.txt"), "not a store")
    healPluginsModuleFallback(home)
    expect(lstatSync(join(home, "home", "profiles", "node_modules", "plain")).isSymbolicLink()).toBe(true)
  })
})

describe("resolveComposedRows (B1: Bridge rows reach the Loader as file:// URLs)", () => {
  test("Bridge-composed rows are rewritten to absolute file:// URLs; official bundle rows keep bare names", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-plugin-b1-"))
    const srcRoot = mkdtempSync(join(tmpdir(), "dsh-plugin-b1-src-"))
    const src = join(srcRoot, "fixture-dsh-plugin")
    mkdirSync(src, { recursive: true })
    writeFileSync(
      join(src, "package.json"),
      JSON.stringify({ name: "fixture-dsh-plugin", version: "1.0.0", type: "module", main: "index.js" }),
    )
    writeFileSync(join(src, "index.js"), "export const name = \"fixture-dsh-plugin\"\nexport function apply(ctx) { ctx.provide(\"fixture-dsh-plugin.marker\", \"mounted\") }\n")
    // The install area layout the installer produces + the healed symlink.
    const installed = join(home, "plugins", "fixture-dsh-plugin", "1.0.0")
    mkdirSync(join(home, "plugins", "fixture-dsh-plugin"), { recursive: true })
    symlinkSync(src, installed, "dir")
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "fixture-dsh-plugin", version: "1.0.0", source: "dir", enabledIn: ["ellamaka-tools"], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    })

    const ctx = new Context()
    const host = await mountDshTools(ctx, { home, port: 0 })
    try {
      const config = (host.includeEntry as unknown as {
        options?: { config?: { patches?: { insert?: PluginLayerPatch[] }[] } }
      }).options?.config
      const insertRows = (config?.patches ?? []).flatMap((row) => row?.insert ?? [])
      const pluginRow = insertRows.find((row) => row.id === "dsh-plugin:fixture-dsh-plugin")
      expect(pluginRow).toBeDefined()
      // The Bridge-composed row reaches the Loader as an absolute file URL
      // into the plugin package's entry file (the healed symlink's target).
      expect(pluginRow!.name.startsWith("file://")).toBe(true)
      expect(decodeURIComponent(pluginRow!.name)).toContain(join("fixture-dsh-plugin", "index.js"))
      // The plugin itself mounted through that URL.
      expect(ctx.get("fixture-dsh-plugin.marker", false)).toBe("mounted")

      // Official bundle rows keep their bare names (not Bridge-owned).
      const officialRows = (config?.patches ?? []).flatMap((row) => row?.insert ?? []).filter((row) => typeof row.name === "string" && row.name.startsWith("@deepseek-ai/"))
      expect(officialRows.length).toBeGreaterThan(0)
      expect(officialRows.every((row) => !row.name.startsWith("file://"))).toBe(true)
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
      rmSync(home, { recursive: true, force: true })
      rmSync(srcRoot, { recursive: true, force: true })
    }
  }, 60_000)

  test("a fresh mount provides no loader.internal and composed rows resolve to files (拆雷)", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-plugin-b1-fake-"))
    const ctx = new Context()
    const host = await mountDshTools(ctx, { home, port: 0 })
    try {
      const loader = ctx.get("loader") as { internal?: { import(name: string): Promise<unknown> } } | undefined
      expect(loader).toBeDefined()
      // The Bridge no longer injects a fake internal under bun: the property
      // stays unset, so official bare-name resolution falls back to native
      // import() (Path 1, spike record).
      expect(loader!.internal).toBeUndefined()

      // B1 验收: every hmr row in the composed stack stays disabled — the
      // official cordis-plugin-hmr constructor must never run under bun.
      const includeConfig = (host.includeEntry as unknown as {
        options?: { config?: { patches?: Record<string, unknown>[] } }
      }).options?.config
      const hmrRows = (includeConfig?.patches ?? []).flatMap((row) => row?.insert ?? []).filter((row) => row.id === "hmr")
      expect(hmrRows.length).toBeGreaterThan(0)
      expect(hmrRows.every((row) => row.disabled === true)).toBe(true)

      // The boot composition's own rows are rewritten BEFORE the Loader sees
      // them — the stack context still carries the same rows.
      const insertRows = (host.stackContext.pluginLayers ?? [])
      for (const row of insertRows) {
        expect(row.name.startsWith("file://")).toBe(true)
      }
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
      rmSync(home, { recursive: true, force: true })
    }
  }, 60_000)

  test("a hot replay rewrites freshly composed rows before the include update", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-plugin-b1-hot-"))
    const srcRoot = mkdtempSync(join(tmpdir(), "dsh-plugin-b1-hot-src-"))
    const src = join(srcRoot, "fixture-dsh-plugin")
    mkdirSync(src, { recursive: true })
    writeFileSync(
      join(src, "package.json"),
      JSON.stringify({ name: "fixture-dsh-plugin", version: "1.0.0", type: "module", main: "index.js" }),
    )
    writeFileSync(join(src, "index.js"), "export const name = \"fixture-dsh-plugin\"\nexport function apply(ctx) { ctx.provide(\"fixture-dsh-plugin.marker\", \"mounted\") }\n")
    const installed = join(home, "plugins", "fixture-dsh-plugin", "1.0.0")
    mkdirSync(join(home, "plugins", "fixture-dsh-plugin"), { recursive: true })
    symlinkSync(src, installed, "dir")
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "fixture-dsh-plugin", version: "1.0.0", source: "dir", enabledIn: ["ellamaka-tools"], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    })

    const ctx = new Context()
    const host = await mountDshTools(ctx, { home, port: 0 })
    let updates = 0
    const seenNames: string[] = []
    const service = startDshPluginService({
      home,
      containers: [{ profile: "ellamaka-tools", ctx, includeEntry: host.includeEntry, stackContext: host.stackContext }],
      intervalMs: 100,
      onReplay: () => updates++,
    })
    try {
      // Touch the store (re-write identical content is enough: the hash
      // short-circuit compares the serialized document, so force a fresh read
      // by adding then removing a disabled phantom entry).
      const store = readStore(home)
      store.plugins.push({
        name: "phantom-hot-plugin",
        version: "1.0.0",
        source: "dir",
        enabledIn: [],
        installedAt: "2026-09-02T00:00:00.000Z",
      })
      await writeStore(home, store)
      await waitFor(() => updates, 1)

      // The include update carried file:// rows for every Bridge-composed
      // plugin (captured through the live entry options after the replay).
      const config = (host.includeEntry as unknown as {
        options?: { config?: { patches?: { insert?: PluginLayerPatch[] }[] } }
      }).options?.config
      const insertRows = (config?.patches ?? []).flatMap((row) => row?.insert ?? [])
      for (const row of insertRows) {
        if (row.id.startsWith(PLUGIN_ENTRY_ID_PREFIX)) seenNames.push(row.name)
      }
      expect(seenNames.length).toBeGreaterThan(0)
      expect(seenNames.every((name) => name.startsWith("file://"))).toBe(true)
      expect(updates).toBeGreaterThanOrEqual(1)
    } finally {
      await service.stop()
      await host.dispose()
      await ctx.fiber.dispose()
      rmSync(home, { recursive: true, force: true })
      rmSync(srcRoot, { recursive: true, force: true })
    }
  }, 60_000)
})

describe("loader.internal.import profiles fallback (rook W-01, post-B1)", () => {
  test("an EXISTING internal import is wrapped so user plugins resolve via profiles", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-plugin-w01-"))
    // Install the fixture plugin (source:dir, like the CLI add path).
    const srcRoot = mkdtempSync(join(tmpdir(), "dsh-plugin-w01-src-"))
    const src = join(srcRoot, "fixture-dsh-plugin")
    mkdirSync(src, { recursive: true })
    writeFileSync(
      join(src, "package.json"),
      JSON.stringify({ name: "fixture-dsh-plugin", version: "1.0.0", type: "module", main: "index.js", dsh: { bundle: { patch: "./cordis.patch.yml" } } }),
    )
    writeFileSync(join(src, "cordis.patch.yml"), "[]\n")
    writeFileSync(
      join(src, "index.js"),
      'export const name = "fixture-dsh-plugin"\nexport function apply(ctx) { ctx.provide("fixture-dsh-plugin.marker", "mounted") }\n',
    )
    // The install area layout the installer produces + the healed symlink.
    const installed = join(home, "plugins", "fixture-dsh-plugin", "1.0.0")
    mkdirSync(join(home, "plugins", "fixture-dsh-plugin"), { recursive: true })
    symlinkSync(src, installed, "dir")
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "fixture-dsh-plugin", version: "1.0.0", source: "dir", enabledIn: ["ellamaka-tools"], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    })

    const ctx = new Context()
    const host = await mountDshTools(ctx, {
      home,
      port: 0,
      // The prepare hook runs after the Loader mounts and BEFORE the wrap:
      // install a stub internal.import simulating the Node internal-loader
      // path (rook W-01: the closure/internal loader resolves official
      // packages — absolute file:// URLs import natively — but cannot resolve
      // bare names, e.g. a bare-name row from a user patch layer).
      prepare: (bootCtx) => {
        const loader = bootCtx.get("loader") as { internal?: { import(name: string): Promise<unknown> } } | undefined
        if (loader && loader.internal === undefined) {
          loader.internal = {
            import: async (name: string) => {
              if (name.startsWith("file://")) {
                return import(/* @vite-ignore */ name)
              }
              throw new Error(`stub internal loader cannot resolve ${name}`)
            },
          }
        }
      },
    })
    try {
      // The Bridge-composed row arrives as a file:// URL and mounts through
      // the stub internal loader's native branch.
      expect(ctx.get("fixture-dsh-plugin.marker", false)).toBe("mounted")
      // The wrap engaged: the internal import is now the profiles-fallback
      // chain, so a BARE name still resolves through the profiles anchor.
      const loader = ctx.get("loader") as { internal?: { import(name: string): Promise<unknown> } }
      const viaProfiles = await loader.internal!.import("fixture-dsh-plugin")
      expect(viaProfiles).toBeDefined()
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
      rmSync(home, { recursive: true, force: true })
      rmSync(srcRoot, { recursive: true, force: true })
    }
  }, 60_000)
})
