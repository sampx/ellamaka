import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  composeDshDumpLayers,
  dumpDshConfig,
  homePatches,
  webExtraPatches,
  toolsExtraPatches,
} from "../src/diagnostics/dump-config"
import { healPluginsModuleFallback, profileDirOf, type PluginLayerPatch } from "../src/plugins/compose"
import { appendBundle, withProfileManifestWrite } from "../src/plugins/profile-manifest"

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "dsh-dump-config-"))
}

async function installedPlugin(home: string, name: string, version = "1.0.0"): Promise<void> {
  const profileDir = profileDirOf(home, "web")
  const dir = join(profileDir, "node_modules", name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version, type: "module", main: "index.js", dsh: { bundle: { patch: "./cordis.patch.yml" } } }),
  )
  writeFileSync(join(dir, "index.js"), `export const name = ${JSON.stringify(name)}\n`)
  writeFileSync(
    join(dir, "cordis.patch.yml"),
    `- insert:\n    - id: dsh-plugin:${name}\n      name: ${name}\n`,
  )
  await withProfileManifestWrite(profileDir, (manifest) => {
    // Seed the official web template bundles first (initProfile semantics
    // for a pre-created manifest), then the fixture plugin.
    const dsh = (manifest.dsh ??= {}) as Record<string, unknown>
    const profile = (dsh.profile ??= {}) as Record<string, unknown>
    profile.bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
    appendBundle(manifest, name)
  })
}

describe("composeDshDumpLayers", () => {
  test("assembles layers in boot order: bundle -> plugin -> user -> extra -> home", () => {
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
    const homePatches = [{ id: "settings", config: { dshHome: "/home/dir" } }]

    const layers = composeDshDumpLayers({
      profile: mockProfile,
      pluginLayers,
      extraPatches,
      homePatches,
    })

    // Expect 5 layers:
    // 1. bundle @deepseek-ai/dsh-base
    // 2. bundle @deepseek-ai/dsh-web-app
    // 3. ellamaka plugin layers (profile) -> [{ insert: pluginLayers }]
    // 4. user layer (/mock/profile/dir/cordis.patch.yml) -> profile.patches
    // 5. bridge extra patches -> extraPatches
    // 6. home patches -> homePatches
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
      label: "ellamaka plugin layers (profile)",
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
      label: "ellamaka home patches",
      patches: homePatches,
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
      homePatches: [],
    })

    // pluginLayers is empty -> no plugin layer
    // profile.patches is empty -> no user layer
    // extraPatches is empty -> no extra layer
    // homePatches is empty -> no home layer
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
      homePatches: [],
    })

    expect(layers.map((l) => l.label)).toEqual([
      "@deepseek-ai/dsh-base",
      "ellamaka plugin layers (profile)",
    ])
  })
})

describe("dumpDshConfig", () => {
  test("dumps configuration for web profile with comments, plugin layers, and home patches", async () => {
    const home = tempHome()
    await installedPlugin(home, "demo-plugin", "1.0.0")
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
    // Contains home patch injection
    expect(output).toContain("settings")
    // The injected dshHome value must be EXACTLY the derived DSH home
    // (<root>/home), never the territory root itself — pins the
    // territory-root -> homeDir derivation against a dshRoot mispass.
    // renderConfigDump emits each config value as a YAML folded scalar: a
    // `dshHome: >-` key line followed by the path indented on its own line,
    // so the value is read from the line after each key.
    const outputLines = output.split("\n")
    const dshHomeValues = outputLines
      .map((line, i) => (line.trim() === "dshHome: >-" ? outputLines[i + 1]?.trim() : undefined))
      .filter((v): v is string => v !== undefined)
    expect(dshHomeValues.length).toBeGreaterThan(0)
    expect(dshHomeValues.every((v) => v === join(home, "home"))).toBe(true)
  })

  test("defaultOnly produces bundle layers only without user/plugin/extra/home layers", async () => {
    const home = tempHome()
    await installedPlugin(home, "demo-plugin", "1.0.0")
    healPluginsModuleFallback(home)
    // A real, already-initialised profile dir: a manifest carrying the web
    // bundle list (so loadProfile resolves bundle layers) plus a user patch
    // file. defaultOnly must skip the patch file via userLayer:false — not
    // merely because the file is absent.
    const webDir = join(home, "home", "profiles", "web")
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
    // defaultOnly should NOT contain plugin layers, extra/home patches, or
    // the user patch file's marker (userLayer:false skips the patch file).
    expect(output).not.toContain("demo-plugin")
    expect(output).not.toContain("ellamaka plugin layers")
    expect(output).not.toContain("ellamaka home patches")
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
  test("homePatches matches dsh-web original shape exactly", () => {
    const homeDir = "/test/home/dir"
    const patches = homePatches(homeDir)
    expect(patches).toEqual([
      { id: "settings", config: { dshHome: homeDir } },
      { id: "credentials", config: { dshHome: homeDir } },
      { id: "attachment-local", config: { dshHome: homeDir } },
      { id: "shell-env", config: { dshHome: homeDir } },
      { id: "agent-instructions", config: { dshHome: homeDir, maxBytes: 65536 } },
      { id: "skill-filesystem", config: { dshHome: homeDir } },
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

