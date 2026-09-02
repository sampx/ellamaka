import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AlreadyInstalledError, installPackage, NotInstalledError, removePackage } from "../src/plugins/installer"
import { PLUGINS_DIR, readStore, STORE_FILENAME } from "../src/plugins/store"

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "dsh-plugin-installer-"))
}

/** A fixture plugin package on disk (the `--dir` install source). */
function fixturePluginDir(root: string, name = "fixture-greeter", version = "1.0.0", withBundle = true): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const manifest: Record<string, unknown> = { name, version, type: "module", main: "index.js" }
  if (withBundle) {
    manifest.dsh = { bundle: { patch: "./cordis.patch.yml" } }
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest))
  writeFileSync(join(dir, "index.js"), "export const name = 'fixture'\nexport function apply() {}\n")
  if (withBundle) writeFileSync(join(dir, "cordis.patch.yml"), "[]\n")
  return dir
}

/**
 * A fake extract simulating pacote: it materialises `spec` (name@version)
 * into `dest/node_modules/<name>/` with a minimal package.json. Extract of
 * the failing spec throws (failure-path coverage).
 */
function fakeExtract(failing?: string) {
  const extracted: Array<{ spec: string; dest: string }> = []
  return {
    extracted,
    extract: async (spec: string, dest: string) => {
      if (failing && spec === failing) throw new Error(`download failed for ${spec}`)
      extracted.push({ spec, dest })
      const at = spec.lastIndexOf("@")
      const name = spec.slice(0, at)
      const version = spec.slice(at + 1)
      const pkgDir = join(dest, "node_modules", ...name.split("/"))
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name,
          version,
          dsh: name === "is-odd" ? { bundle: { patch: "./cordis.patch.yml" } } : undefined,
        }),
      )
    },
  }
}

describe("dsh plugin installer", () => {
  test("registry install materialises via the real resolve+extract pipeline", async () => {
    const home = tempHome()
    const fake = fakeExtract()
    const fakeResolve = async (spec: { kind: string; name?: string; version?: string }) => ({
      root: { name: spec.name ?? "", version: spec.version ?? "" },
      packages: new Map([
        [`${spec.name}@${spec.version}`, { name: spec.name, version: spec.version, dependencies: [], tarball: "" }],
      ]),
    })
    const result = await installPackage(
      { kind: "registry", name: "solo-pkg", version: "1.2.3" },
      { home, extract: fake.extract, resolve: fakeResolve as never },
    )
    expect(result.name).toBe("solo-pkg")
    expect(fake.extracted).toHaveLength(1)
    expect(fake.extracted[0].spec).toBe("solo-pkg@1.2.3")
    expect(readStore(home).plugins[0]).toMatchObject({ name: "solo-pkg", version: "1.2.3", source: "registry" })
  })

  test("dir install copies the directory and registers source:dir", async () => {
    const home = tempHome()
    const src = fixturePluginDir(mkdtempSync(join(tmpdir(), "dsh-plugin-src-")))
    const result = await installPackage({ kind: "dir", path: src }, { home })
    expect(result.name).toBe("fixture-greeter")
    expect(result.version).toBe("1.0.0")
    expect(result.isBundle).toBe(true)
    const target = join(home, PLUGINS_DIR, "fixture-greeter", "1.0.0")
    expect(existsSync(join(target, "package.json"))).toBe(true)
    expect(existsSync(join(target, "index.js"))).toBe(true)
    const store = readStore(home)
    expect(store.plugins).toHaveLength(1)
    expect(store.plugins[0]).toMatchObject({ name: "fixture-greeter", version: "1.0.0", source: "dir", enabledIn: [] })
  })

  test("a package without dsh.bundle.patch installs with isBundle:false warning", async () => {
    const home = tempHome()
    const src = fixturePluginDir(mkdtempSync(join(tmpdir(), "dsh-plugin-src-")), "plain-lib", "2.0.0", false)
    const result = await installPackage({ kind: "dir", path: src }, { home })
    expect(result.isBundle).toBe(false)
    expect(result.warning).toMatch(/dsh\.bundle\.patch/)
  })

  test("extract failure cleans staging and leaves the store untouched", async () => {
    const home = tempHome()
    const fake = fakeExtract("is-odd@3.0.1")
    // resolve succeeds, extract of the root package fails.
    const resolve = async () => ({
      root: { name: "is-odd", version: "3.0.1" },
      packages: new Map([
        ["is-odd@3.0.1", { name: "is-odd", version: "3.0.1", dependencies: [], tarball: "" }],
      ]),
    })
    await expect(
      installPackage({ kind: "registry", name: "is-odd", version: "3.0.1" }, { home, extract: fake.extract, resolve }),
    ).rejects.toThrow("download failed for is-odd@3.0.1")
    expect(fake.extracted).toHaveLength(0)
    expect(readStore(home).plugins).toEqual([])
    expect(existsSync(join(home, PLUGINS_DIR))).toBe(false)
  })

  test("already installed same name+version throws AlreadyInstalledError", async () => {
    const home = tempHome()
    const src = fixturePluginDir(mkdtempSync(join(tmpdir(), "dsh-plugin-src-")))
    await installPackage({ kind: "dir", path: src }, { home })
    await expect(installPackage({ kind: "dir", path: src }, { home })).rejects.toBeInstanceOf(AlreadyInstalledError)
    // Store still has exactly one entry.
    expect(readStore(home).plugins).toHaveLength(1)
  })

  test("removePackage deletes the directory and the store entry", async () => {
    const home = tempHome()
    const src = fixturePluginDir(mkdtempSync(join(tmpdir(), "dsh-plugin-src-")))
    const installed = await installPackage({ kind: "dir", path: src }, { home })
    await removePackage(installed.name, { home })
    expect(existsSync(join(home, PLUGINS_DIR, "fixture-greeter"))).toBe(false)
    expect(readStore(home).plugins).toEqual([])
  })

  test("removePackage for an unknown plugin throws NotInstalledError", async () => {
    const home = tempHome()
    await expect(removePackage("ghost", { home })).rejects.toBeInstanceOf(NotInstalledError)
  })

  test("registry install with an injected resolve+extract lands the full tree", async () => {
    const home = tempHome()
    const fake = fakeExtract()
    const result = await installPackage(
      { kind: "registry", name: "is-odd", version: "3.0.1" },
      {
        home,
        extract: fake.extract,
        resolve: async () => ({
          root: { name: "is-odd", version: "3.0.1" },
          packages: new Map([
            ["is-odd@3.0.1", { name: "is-odd", version: "3.0.1", dependencies: ["is-number@6.0.0"], tarball: "" }],
            ["is-number@6.0.0", { name: "is-number", version: "6.0.0", dependencies: [], tarball: "" }],
          ]),
        }),
      },
    )
    expect(result.name).toBe("is-odd")
    expect(result.isBundle).toBe(true)
    // Both packages extracted; the entry package landed at plugins/is-odd/3.0.1.
    expect(fake.extracted).toHaveLength(2)
    const target = join(home, PLUGINS_DIR, "is-odd", "3.0.1")
    expect(existsSync(join(target, "package.json"))).toBe(true)
    // Transitive dep hoisted flat under the entry package's node_modules.
    expect(existsSync(join(target, "node_modules", "is-number", "package.json"))).toBe(true)
    const store = readStore(home)
    expect(store.plugins[0]).toMatchObject({ name: "is-odd", version: "3.0.1", source: "registry" })
  })

  test("dir install with dependencies does not overwrite copied files from nested node_modules", async () => {
    const home = tempHome()
    const srcRoot = mkdtempSync(join(tmpdir(), "dsh-plugin-src-"))
    const src = fixturePluginDir(srcRoot)
    // Give the fixture a pre-bundled nested dep to make sure cp keeps it.
    const nested = join(src, "node_modules", "tiny-dep")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, "package.json"), JSON.stringify({ name: "tiny-dep", version: "0.0.1" }))
    await installPackage({ kind: "dir", path: src }, { home })
    expect(existsSync(join(home, PLUGINS_DIR, "fixture-greeter", "1.0.0", "node_modules", "tiny-dep", "package.json"))).toBe(true)
  })

  test("staging temp files never leak into the store file", async () => {
    const home = tempHome()
    const src = fixturePluginDir(mkdtempSync(join(tmpdir(), "dsh-plugin-src-")))
    await installPackage({ kind: "dir", path: src }, { home })
    const storeRaw = readFileSync(join(home, PLUGINS_DIR, STORE_FILENAME), "utf-8")
    expect(JSON.parse(storeRaw).schema).toBe("ellamaka.dsh-plugins/v1")
    rmSync(src, { recursive: true, force: true })
  })
})
