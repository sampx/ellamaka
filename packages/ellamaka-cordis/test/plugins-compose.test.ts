import { describe, expect, test } from "bun:test"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context } from "@deepseek-ai/cordis"
import { mountDshTools } from "../src/dsh-web"
import { startDshPluginService } from "../src/plugins/runtime"
import { readProfileManifest, withProfileManifestWrite, appendBundle } from "../src/plugins/profile-manifest"
import {
  composeFullPatchStack,
  composePluginLayers,
  PLUGIN_ENTRY_ID_PREFIX,
  healPluginsModuleFallback,
  removePluginSymlink,
  type PluginLayerPatch,
} from "../src/plugins/compose"
import { resolveComposedRows } from "../src/plugins/resolve-specifiers"

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "dsh-plugin-compose-"))
}

/** The profile directory fixture for a territory root. */
function profileDirOf(root: string, profile = "web"): string {
  return join(root, "home", "profiles", profile)
}

/**
 * A fixture plugin package placed in the profile's node_modules (the official
 * install-area layout the Bun installer lands): the source tree is materialised
 * under `<profile>/node_modules/<name>/` with its manifest, entry file and
 * bundle patch file.
 */
function installedPlugin(
  root: string,
  name: string,
  opts: { version?: string; bundle?: boolean | string; marker?: string; profile?: string } = {},
): string {
  const { version = "1.0.0", bundle = true, marker = "m", profile = "web" } = opts
  const dir = join(profileDirOf(root, profile), "node_modules", ...name.split("/"))
  mkdirSync(dir, { recursive: true })
  const manifest: Record<string, unknown> = { name, version, type: "module", main: "index.js" }
  if (bundle) {
    manifest.dsh = { bundle: { patch: typeof bundle === "string" ? bundle : "./cordis.patch.yml" } }
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest))
  writeFileSync(
    join(dir, "index.js"),
    `export const name = ${JSON.stringify(name)}\nexport function apply(ctx) { ctx.provide(${JSON.stringify(name + ".marker")}, ${JSON.stringify(marker)}) }\n`,
  )
  if (bundle) {
    writeFileSync(
      join(dir, typeof bundle === "string" ? bundle : "./cordis.patch.yml"),
      `- insert:\n    - id: dsh-plugin:${name}\n      name: ${JSON.stringify(name)}\n`,
    )
  }
  return dir
}

/** Register the plugin as installed in the profile manifest (the truth source). */
async function registerInstalled(root: string, name: string, profile = "web"): Promise<void> {
  await withProfileManifestWrite(profileDirOf(root, profile), (manifest) => {
    appendBundle(manifest, name)
  })
}

/** Seed the raw manifest document (bypasses the write layer for edge shapes). */
function seedManifest(root: string, manifest: Record<string, unknown>, profile = "web"): void {
  mkdirSync(profileDirOf(root, profile), { recursive: true })
  writeFileSync(join(profileDirOf(root, profile), "package.json"), JSON.stringify(manifest, null, 2) + "\n")
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

describe("composePluginLayers (profile manifest truth source)", () => {
  test("a missing manifest composes no layers (fresh profile)", () => {
    const root = tempRoot()
    expect(composePluginLayers(root, "web")).toEqual([])
  })

  test("a manifest with no bundles composes no layers", () => {
    const root = tempRoot()
    seedManifest(root, { name: "web" })
    expect(composePluginLayers(root, "web")).toEqual([])
  })

  test("bundles that are all official rows compose no layers (official rows are the bundle layer)", () => {
    const root = tempRoot()
    seedManifest(root, { dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } } })
    expect(composePluginLayers(root, "web")).toEqual([])
  })

  test("a user bundle with no installed package entity throws a named diagnostic", () => {
    const root = tempRoot()
    seedManifest(root, { dsh: { profile: { bundles: ["dshmarket"] } } })
    expect(() => composePluginLayers(root, "web")).toThrow(/dshmarket/)
  })

  test("the user segment composes patch rows from the package's cordis.patch.yml", async () => {
    const root = tempRoot()
    installedPlugin(root, "web-only", { marker: "w" })
    await registerInstalled(root, "web-only")
    healPluginsModuleFallback(root)
    const layers = composePluginLayers(root, "web")
    expect(layers).toHaveLength(1)
    expect(layers[0].id).toBe("dsh-plugin:web-only")
    // The composed row comes from the package's OWN cordis.patch.yml insert
    // list, resolved to the entry file's absolute file:// URL.
    expect(layers[0].name.startsWith("file://")).toBe(true)
    expect(decodeURIComponent(layers[0].name)).toContain(join("node_modules", "web-only", "index.js"))
  })

  test("official bundles are skipped; only the user segment produces rows", () => {
    const root = tempRoot()
    installedPlugin(root, "user-plugin")
    seedManifest(root, {
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "user-plugin"] } },
    })
    healPluginsModuleFallback(root)
    const layers = composePluginLayers(root, "web")
    expect(layers).toHaveLength(1)
    expect(layers[0].id).toBe("dsh-plugin:user-plugin")
  })

  test("layers follow manifest bundle order and carry explicit stable ids", () => {
    const root = tempRoot()
    installedPlugin(root, "alpha")
    installedPlugin(root, "beta")
    seedManifest(root, { dsh: { profile: { bundles: ["beta", "alpha"] } } })
    healPluginsModuleFallback(root)
    const layers = composePluginLayers(root, "web")
    expect(layers.map((l) => l.id)).toEqual(["dsh-plugin:beta", "dsh-plugin:alpha"])
  })

  test("the row name resolves to the package entry file under the profile node_modules", async () => {
    const root = tempRoot()
    installedPlugin(root, "scoped-plugin", { version: "0.1.0" })
    await registerInstalled(root, "scoped-plugin")
    healPluginsModuleFallback(root)
    const layers = composePluginLayers(root, "web")
    expect(layers[0].name.startsWith("file://")).toBe(true)
    expect(decodeURIComponent(layers[0].name)).toContain(join("node_modules", "scoped-plugin"))
    expect(PLUGIN_ENTRY_ID_PREFIX).toBe("dsh-plugin:")
  })

  test("a bundle row whose patch file is missing throws a named diagnostic", () => {
    const root = tempRoot()
    const dir = installedPlugin(root, "patchless-bundle", { bundle: "./missing.yml" })
    rmSync(join(dir, "missing.yml")) // the fixture writes it; the test needs it gone
    seedManifest(root, { dsh: { profile: { bundles: ["patchless-bundle"] } } })
    expect(() => composePluginLayers(root, "web")).toThrow(/missing\.yml/)
  })

  test("composeFullPatchStack keeps the official sandwich around the plugin layer", () => {
    const pluginLayers: PluginLayerPatch[] = [{ id: "dsh-plugin:x", name: "file:///x/index.js" }]
    const stack = composeFullPatchStack({
      profileLayers: [{ patches: [{ id: "bundle-row" }] }],
      pluginLayers,
      userPatches: [{ id: "user-row" }],
      extraPatches: [{ id: "extra-row" }],
      homePatches: [{ id: "home-row" }],
    })
    expect(stack).toEqual([
      { id: "bundle-row" },
      { insert: pluginLayers },
      { id: "user-row" },
      { id: "extra-row" },
      { id: "home-row" },
    ])
  })
})

describe("healPluginsModuleFallback (profile manifest source)", () => {
  test("symlinks every declared user plugin under profiles/node_modules", async () => {
    const root = tempRoot()
    const dir = installedPlugin(root, "link-me")
    await registerInstalled(root, "link-me")
    healPluginsModuleFallback(root)
    const link = join(root, "home", "profiles", "node_modules", "link-me")
    expect(existsSync(link)).toBe(true)
    expect(realpathSync(link)).toBe(realpathSync(dir))
  })

  test("re-points a stale link when the plugin is reinstalled (new entity dir)", async () => {
    const root = tempRoot()
    const dir = installedPlugin(root, "mover")
    // Seed a stale link pointing at a non-existent old entity location.
    const modulesDir = join(root, "home", "profiles", "node_modules")
    mkdirSync(modulesDir, { recursive: true })
    symlinkSync(join(root, "gone"), join(modulesDir, "mover"), "dir")
    await registerInstalled(root, "mover")
    healPluginsModuleFallback(root)
    expect(realpathSync(join(modulesDir, "mover"))).toBe(realpathSync(dir))
  })

  test("replaces a DANGLING self-owned link (rook B-06)", async () => {
    const root = tempRoot()
    const dir = installedPlugin(root, "resurrected")
    const modulesDir = join(root, "home", "profiles", "node_modules")
    mkdirSync(modulesDir, { recursive: true })
    symlinkSync(join(root, "gone-plugin-dir"), join(modulesDir, "resurrected"), "dir")
    await registerInstalled(root, "resurrected")
    healPluginsModuleFallback(root)
    expect(realpathSync(join(modulesDir, "resurrected"))).toBe(realpathSync(dir))
  })

  test("keeps non-plugin entries already present in profiles/node_modules", () => {
    const root = tempRoot()
    const modulesDir = join(root, "home", "profiles", "node_modules")
    mkdirSync(modulesDir, { recursive: true })
    const foreign = join(root, "elsewhere")
    mkdirSync(foreign)
    symlinkSync(foreign, join(modulesDir, "official-pkg"), "dir")
    seedManifest(root, { name: "web" })
    healPluginsModuleFallback(root)
    // The foreign link is untouched and still resolves.
    expect(realpathSync(join(modulesDir, "official-pkg"))).toBe(realpathSync(foreign))
  })

  test("damaged installs (no package.json) are skipped, not linked", async () => {
    const root = tempRoot()
    const dir = installedPlugin(root, "damaged")
    rmSync(join(dir, "package.json"))
    await registerInstalled(root, "damaged")
    healPluginsModuleFallback(root)
    expect(existsSync(join(root, "home", "profiles", "node_modules", "damaged"))).toBe(false)
  })

  test("removePluginSymlink clears our link and leaves foreign entries alone", async () => {
    const root = tempRoot()
    installedPlugin(root, "removeme")
    await registerInstalled(root, "removeme")
    healPluginsModuleFallback(root)
    const link = join(root, "home", "profiles", "node_modules", "removeme")
    expect(existsSync(link)).toBe(true)
    removePluginSymlink(root, "removeme")
    expect(existsSync(link)).toBe(false)
    // A second call is a no-op (nothing there).
    removePluginSymlink(root, "removeme")
  })
})

describe("resolveComposedRows (B1: Bridge rows reach the Loader as file:// URLs)", () => {
  test("Bridge-composed rows are rewritten to absolute file:// URLs; official bundle rows keep bare names", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-plugin-b1-"))
    const srcRoot = mkdtempSync(join(tmpdir(), "dsh-plugin-b1-src-"))
    const src = join(srcRoot, "fixture-dsh-plugin")
    mkdirSync(src, { recursive: true })
    writeFileSync(
      join(src, "package.json"),
      JSON.stringify({ name: "fixture-dsh-plugin", version: "1.0.0", type: "module", main: "index.js", dsh: { bundle: { patch: "./cordis.patch.yml" } } }),
    )
    writeFileSync(join(src, "cordis.patch.yml"), "- insert:\n    - id: dsh-plugin:fixture-dsh-plugin\n      name: fixture-dsh-plugin\n")
    writeFileSync(join(src, "index.js"), "export const name = \"fixture-dsh-plugin\"\nexport function apply(ctx) { ctx.provide(\"fixture-dsh-plugin.marker\", \"mounted\") }\n")
    // The official install-area layout: the package entity under the
    // profile's node_modules (mountDshTools inits the web profile template).
    // mountDshTools mounts the "ellamaka-tools" profile: the fixture must
    // target THAT profile's manifest and node_modules.
    const profileDir = profileDirOf(root, "ellamaka-tools")
    mkdirSync(join(profileDir, "node_modules"), { recursive: true })
    cpSync(src, join(profileDir, "node_modules", "fixture-dsh-plugin"), { recursive: true })
    await withProfileManifestWrite(profileDir, (manifest) => {
      // Seed the official tools template bundles first (initProfile
      // semantics for a pre-created manifest), then the fixture.
      const dsh = (manifest.dsh ??= {}) as Record<string, unknown>
      const profile = (dsh.profile ??= {}) as Record<string, unknown>
      profile.bundles = ["@deepseek-ai/dsh-base"]
      appendBundle(manifest, "fixture-dsh-plugin")
    })
    healPluginsModuleFallback(root)

    const ctx = new Context()
    const host = await mountDshTools(ctx, { home: root, port: 0 })
    try {
      const config = (host.includeEntry as unknown as {
        options?: { config?: { patches?: { insert?: PluginLayerPatch[] }[] } }
      }).options?.config
      const insertRows = (config?.patches ?? []).flatMap((row) => row?.insert ?? [])
      const pluginRow = insertRows.find((row) => row.id === "dsh-plugin:fixture-dsh-plugin")
      expect(pluginRow).toBeDefined()
      // The Bridge-composed row reaches the Loader as an absolute file URL
      // into the plugin package's entry file under the profile node_modules.
      expect(pluginRow!.name.startsWith("file://")).toBe(true)
      expect(decodeURIComponent(pluginRow!.name)).toContain(join("node_modules", "fixture-dsh-plugin", "index.js"))
      // The plugin itself mounted through that URL.
      expect(ctx.get("fixture-dsh-plugin.marker", false)).toBe("mounted")

      // Official bundle rows keep their bare names (not Bridge-owned).
      const officialRows = (config?.patches ?? []).flatMap((row) => row?.insert ?? []).filter((row) => typeof row.name === "string" && row.name.startsWith("@deepseek-ai/"))
      expect(officialRows.length).toBeGreaterThan(0)
      expect(officialRows.every((row) => !row.name.startsWith("file://"))).toBe(true)
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
      rmSync(srcRoot, { recursive: true, force: true })
    }
  }, 60_000)

  test("a fresh mount provides no loader.internal and composed rows resolve to files (拆雷)", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-plugin-b1-fake-"))
    const ctx = new Context()
    const host = await mountDshTools(ctx, { home: root, port: 0 })
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
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)

  test("a hot replay rewrites freshly composed rows before the include update", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-plugin-b1-hot-"))
    const srcRoot = mkdtempSync(join(tmpdir(), "dsh-plugin-b1-hot-src-"))
    const src = join(srcRoot, "fixture-dsh-plugin")
    mkdirSync(src, { recursive: true })
    writeFileSync(
      join(src, "package.json"),
      JSON.stringify({ name: "fixture-dsh-plugin", version: "1.0.0", type: "module", main: "index.js", dsh: { bundle: { patch: "./cordis.patch.yml" } } }),
    )
    writeFileSync(join(src, "cordis.patch.yml"), "- insert:\n    - id: dsh-plugin:fixture-dsh-plugin\n      name: fixture-dsh-plugin\n")
    writeFileSync(join(src, "index.js"), "export const name = \"fixture-dsh-plugin\"\nexport function apply(ctx) { ctx.provide(\"fixture-dsh-plugin.marker\", \"mounted\") }\n")
    // mountDshTools mounts the "ellamaka-tools" profile: the fixture must
    // target THAT profile's manifest and node_modules.
    const profileDir = profileDirOf(root, "ellamaka-tools")
    mkdirSync(join(profileDir, "node_modules"), { recursive: true })
    cpSync(src, join(profileDir, "node_modules", "fixture-dsh-plugin"), { recursive: true })
    await withProfileManifestWrite(profileDir, (manifest) => {
      // Seed the official tools template bundles first (initProfile
      // semantics for a pre-created manifest), then the fixture.
      const dsh = (manifest.dsh ??= {}) as Record<string, unknown>
      const profile = (dsh.profile ??= {}) as Record<string, unknown>
      profile.bundles = ["@deepseek-ai/dsh-base"]
      appendBundle(manifest, "fixture-dsh-plugin")
    })
    healPluginsModuleFallback(root)

    const ctx = new Context()
    const host = await mountDshTools(ctx, { home: root, port: 0 })
    let updates = 0
    const seenNames: string[] = []
    const service = startDshPluginService({
      home: root,
      containers: [{ profile: "ellamaka-tools", ctx, includeEntry: host.includeEntry, stackContext: host.stackContext }],
      intervalMs: 100,
      onReplay: () => updates++,
    })
    try {
      // The service watches the PROFILE's composition files under the
      // tools profile: touching its manifest (re-write identical content is
      // enough — the hash short-circuit compares serialized documents) must
      // trigger exactly one replay. We append+remove a dependency to change
      // the serialized document, then restore it.
      await withProfileManifestWrite(profileDir, (manifest) => {
        // Dependencies-only mutation: the serialized manifest changes (the
        // watch fires) without adding an unresolvable bundle row.
        const deps = (manifest.dependencies ??= {}) as Record<string, string>
        deps["phantom-hot-plugin"] = "1.0.0"
      })
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
      rmSync(root, { recursive: true, force: true })
      rmSync(srcRoot, { recursive: true, force: true })
    }
  }, 60_000)
})

describe("loader.internal.import profiles fallback (rook W-01, post-B1)", () => {
  test("an EXISTING internal import is wrapped so user plugins resolve via profiles", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-plugin-w01-"))
    const srcRoot = mkdtempSync(join(tmpdir(), "dsh-plugin-w01-src-"))
    const src = join(srcRoot, "fixture-dsh-plugin")
    mkdirSync(src, { recursive: true })
    writeFileSync(
      join(src, "package.json"),
      JSON.stringify({ name: "fixture-dsh-plugin", version: "1.0.0", type: "module", main: "index.js", dsh: { bundle: { patch: "./cordis.patch.yml" } } }),
    )
    writeFileSync(join(src, "cordis.patch.yml"), "- insert:\n    - id: dsh-plugin:fixture-dsh-plugin\n      name: fixture-dsh-plugin\n")
    writeFileSync(
      join(src, "index.js"),
      'export const name = "fixture-dsh-plugin"\nexport function apply(ctx) { ctx.provide("fixture-dsh-plugin.marker", "mounted") }\n',
    )
    // mountDshTools mounts the "ellamaka-tools" profile: the fixture must
    // target THAT profile's manifest and node_modules.
    const profileDir = profileDirOf(root, "ellamaka-tools")
    mkdirSync(join(profileDir, "node_modules"), { recursive: true })
    cpSync(src, join(profileDir, "node_modules", "fixture-dsh-plugin"), { recursive: true })
    await withProfileManifestWrite(profileDir, (manifest) => {
      // Seed the official tools template bundles first (initProfile
      // semantics for a pre-created manifest), then the fixture.
      const dsh = (manifest.dsh ??= {}) as Record<string, unknown>
      const profile = (dsh.profile ??= {}) as Record<string, unknown>
      profile.bundles = ["@deepseek-ai/dsh-base"]
      appendBundle(manifest, "fixture-dsh-plugin")
    })
    healPluginsModuleFallback(root)

    const ctx = new Context()
    const host = await mountDshTools(ctx, {
      home: root,
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
      rmSync(root, { recursive: true, force: true })
      rmSync(srcRoot, { recursive: true, force: true })
    }
  }, 60_000)
})
