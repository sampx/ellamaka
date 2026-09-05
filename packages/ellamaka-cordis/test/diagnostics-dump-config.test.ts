import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  composeDshDumpLayers,
  dumpDshConfig,
  stateHomePatches,
  webExtraPatches,
  toolsExtraPatches,
} from "../src/diagnostics/dump-config"
import { healPluginsModuleFallback, type PluginLayerPatch } from "../src/plugins/compose"
import { writeStore } from "../src/plugins/store"

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "dsh-dump-config-"))
}

function installedPlugin(home: string, name: string, version = "1.0.0"): string {
  const dir = join(home, "plugins", name, version)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version, type: "module", main: "index.js" }))
  writeFileSync(join(dir, "index.js"), `export const name = ${JSON.stringify(name)}\n`)
  return dir
}

describe("composeDshDumpLayers", () => {
  test("assembles layers in boot order: bundle -> plugin -> user -> extra -> state", () => {
    const mockProfile = {
      dir: "/mock/profile/dir",
      patchPath: "/mock/profile/dir/cordis.patch.yml",
      layers: [
        { packageName: "@deepseek-ai/dsh-base", patches: [{ id: "base-entry" }] },
        { packageName: "@deepseek-ai/dsh-web-app", patches: [{ id: "web-entry" }] },
      ],
      patches: [{ id: "user-patch-row" }],
    }
    const pluginLayers: PluginLayerPatch[] = [
      { id: "dsh-plugin:my-plugin", name: "file:///mock/my-plugin/index.js" },
    ]
    const extraPatches = [{ id: "webserver", disabled: true }]
    const statePatches = [{ id: "settings", config: { dshHome: "/state/dir" } }]

    const layers = composeDshDumpLayers({
      profile: mockProfile,
      pluginLayers,
      extraPatches,
      stateHomePatches: statePatches,
    })

    // Expect 5 layers:
    // 1. bundle @deepseek-ai/dsh-base
    // 2. bundle @deepseek-ai/dsh-web-app
    // 3. ellamaka plugin layers (installed.json) -> [{ insert: pluginLayers }]
    // 4. user layer (/mock/profile/dir/cordis.patch.yml) -> profile.patches
    // 5. bridge extra patches -> extraPatches
    // 6. state home patches -> statePatches
    expect(layers).toHaveLength(6)
    expect(layers[0]).toEqual({
      label: "@deepseek-ai/dsh-base",
      patches: [{ id: "base-entry" }],
    })
    expect(layers[1]).toEqual({
      label: "@deepseek-ai/dsh-web-app",
      patches: [{ id: "web-entry" }],
    })
    expect(layers[2]).toEqual({
      label: "ellamaka plugin layers (installed.json)",
      patches: [{ insert: pluginLayers }],
    })
    expect(layers[3]).toEqual({
      label: "/mock/profile/dir/cordis.patch.yml",
      patches: [{ id: "user-patch-row" }],
    })
    expect(layers[4]).toEqual({
      label: "ellamaka bridge extra patches",
      patches: extraPatches,
    })
    expect(layers[5]).toEqual({
      label: "ellamaka state home patches",
      patches: statePatches,
    })
  })

  test("omits plugin layer when pluginLayers is empty", () => {
    const mockProfile = {
      dir: "/mock/dir",
      patchPath: "/mock/dir/cordis.patch.yml",
      layers: [{ packageName: "@deepseek-ai/dsh-base", patches: [] }],
      patches: [],
    }

    const layers = composeDshDumpLayers({
      profile: mockProfile,
      pluginLayers: [],
      extraPatches: [],
      stateHomePatches: [],
    })

    // pluginLayers is empty -> no plugin layer
    // profile.patches is empty -> no user layer
    // extraPatches is empty -> no extra layer
    // stateHomePatches is empty -> no state layer
    expect(layers).toHaveLength(1)
    expect(layers[0].label).toBe("@deepseek-ai/dsh-base")
  })

  test("omits user layer when profile.patches is empty", () => {
    const mockProfile = {
      dir: "/mock/dir",
      patchPath: "/mock/dir/cordis.patch.yml",
      layers: [{ packageName: "@deepseek-ai/dsh-base", patches: [] }],
      patches: [],
    }

    const layers = composeDshDumpLayers({
      profile: mockProfile,
      pluginLayers: [{ id: "dsh-plugin:p", name: "file:///p.js" }],
      extraPatches: [],
      stateHomePatches: [],
    })

    expect(layers.map((l) => l.label)).toEqual([
      "@deepseek-ai/dsh-base",
      "ellamaka plugin layers (installed.json)",
    ])
  })
})

describe("dumpDshConfig", () => {
  test("dumps configuration for web profile with comments, plugin layers, and state patches", async () => {
    const home = tempHome()
    installedPlugin(home, "demo-plugin", "1.0.0")
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        {
          name: "demo-plugin",
          version: "1.0.0",
          source: "dir",
          enabledIn: ["web"],
          installedAt: "2026-09-04T00:00:00.000Z",
        },
      ],
    })
    healPluginsModuleFallback(home)

    const output = await dumpDshConfig({
      dshHome: home,
      profileName: "web",
    })

    // Output is YAML containing # == grouping comments
    expect(output).toContain("# ==")
    // Contains resolved plugin file:// URL
    expect(output).toContain("file://")
    expect(output).toContain("demo-plugin")
    // Contains state home patch injection
    expect(output).toContain("settings")
    expect(output).toContain("dshHome:")
  })

  test("defaultOnly produces bundle layers only without user/plugin/extra/state layers", async () => {
    const home = tempHome()
    installedPlugin(home, "demo-plugin", "1.0.0")
    await writeStore(home, {
      schema: "ellamaka.dsh-plugins/v1",
      plugins: [
        {
          name: "demo-plugin",
          version: "1.0.0",
          source: "dir",
          enabledIn: ["web"],
          installedAt: "2026-09-04T00:00:00.000Z",
        },
      ],
    })
    healPluginsModuleFallback(home)
    // A real, already-initialised profile dir: a manifest carrying the web
    // bundle list (so loadProfile resolves bundle layers) plus a user patch
    // file. defaultOnly must skip the patch file via userLayer:false — not
    // merely because the file is absent.
    const webDir = join(home, "profiles", "web")
    mkdirSync(webDir, { recursive: true })
    writeFileSync(
      join(webDir, "package.json"),
      JSON.stringify({
        name: "dsh-profile-web",
        private: true,
        dependencies: {},
        dsh: {
          profile: {
            bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
          },
        },
      }) + "\n",
    )
    writeFileSync(
      join(webDir, "cordis.patch.yml"),
      "- { id: timer, config: { note: user-marker } }\n",
    )

    const output = await dumpDshConfig({
      dshHome: home,
      profileName: "web",
      defaultOnly: true,
    })

    expect(output).toContain("# ==")
    // defaultOnly should NOT contain plugin layers, extra/state patches, or
    // the user patch file's marker (userLayer:false skips the patch file).
    expect(output).not.toContain("demo-plugin")
    expect(output).not.toContain("ellamaka plugin layers")
    expect(output).not.toContain("ellamaka state home patches")
    expect(output).not.toContain("user-marker")

    // The same fixture with defaultOnly=false MUST include the user marker —
    // pins the userLayer mechanism both ways (absent file can't fake this).
    const fullOutput = await dumpDshConfig({
      dshHome: home,
      profileName: "web",
    })
    expect(fullOutput).toContain("user-marker")
  })
})

describe("lifted patch builders snapshot equality", () => {
  test("stateHomePatches matches dsh-web original shape exactly", () => {
    const stateDir = "/test/state/dir"
    const patches = stateHomePatches(stateDir)
    expect(patches).toEqual([
      { id: "settings", config: { dshHome: stateDir } },
      { id: "credentials", config: { dshHome: stateDir } },
      { id: "attachment-local", config: { dshHome: stateDir } },
      { id: "shell-env", config: { dshHome: stateDir } },
      { id: "agent-instructions", config: { dshHome: stateDir, maxBytes: 65536 } },
      { id: "skill-filesystem", config: { dshHome: stateDir } },
      { id: "llm-deepseek", disabled: true },
      { id: "session-telemetry-otel", disabled: true },
    ])
  })

  test("webExtraPatches matches mountDshWeb rc.1 shape exactly", () => {
    const patches = webExtraPatches({
      disableCodeRuntime: true,
      extraPatches: [{ id: "custom", extra: 1 }],
    })
    expect(patches).toEqual([
      { id: "code-runtime", disabled: true },
      { id: "webserver", disabled: true },
      {
        id: "web-runtime",
        config: { openBrowser: false, printUrl: false, surfaceContext: false, trustedHosts: [] },
      },
      { id: "custom", extra: 1 },
    ])
  })

  test("toolsExtraPatches matches mountDshTools original shape exactly", () => {
    const patches = toolsExtraPatches({
      extraPatches: [{ id: "custom-tool", config: {} }],
    })
    expect(patches).toEqual([
      { id: "hmr", disabled: true },
      { id: "tool-bash", config: { enableRunInBackground: false } },
      { id: "custom-tool", config: {} },
    ])
  })
})

