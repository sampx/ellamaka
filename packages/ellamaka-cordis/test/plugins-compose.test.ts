import { describe, expect, test } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context } from "@deepseek-ai/cordis"
import {
  composePluginLayers,
  PLUGIN_LAYER_DIRNAME,
  healPluginsModuleFallback,
} from "../src/plugins/compose"
import { writeStore } from "../src/plugins/store"

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "dsh-plugin-compose-"))
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
    const webLayers = composePluginLayers(home, "web")
    expect(webLayers).toHaveLength(1)
    expect(webLayers[0].id).toBe("dsh-plugin:web-only")
    expect(webLayers[0].name).toBe("web-only")

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
    const layers = composePluginLayers(home, "web")
    expect(layers.map((l) => l.id)).toEqual(["dsh-plugin:beta", "dsh-plugin:alpha"])
  })

  test("the layer name points at the plugin package root (bare name)", async () => {
    const home = tempHome()
    installedPlugin(home, "scoped-plugin", "0.1.0")
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        { name: "scoped-plugin", version: "0.1.0", source: "dir", enabledIn: ["web"], installedAt: "2026-09-02T00:00:00.000Z" },
      ],
    })
    const layers = composePluginLayers(home, "web")
    expect(layers[0].name).toBe("scoped-plugin")
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
    const link = join(home, "profiles", "node_modules", "link-me")
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
    const modulesDir = join(home, "profiles", "node_modules")
    mkdirSync(modulesDir, { recursive: true })
    symlinkSync(oldDir, join(modulesDir, "mover"), "dir")
    healPluginsModuleFallback(home)
    expect(realpathSync(join(modulesDir, "mover"))).toBe(realpathSync(newDir))
  })

  test("keeps non-plugin entries already present in profiles/node_modules", async () => {
    const home = tempHome()
    const modulesDir = join(home, "profiles", "node_modules")
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
    expect(lstatSync(join(home, "profiles", "node_modules", "plain")).isSymbolicLink()).toBe(true)
  })
})
