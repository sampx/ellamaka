import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const module = await import("../src/inventory")
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs.length = 0
})

function makeTempdir() {
  const dir = mkdtempSync(join(tmpdir(), "ellamaka-inventory-test-"))
  tempDirs.push(dir)
  return dir
}

describe("capture-legacy-release-inventory", () => {
  test("dry-run writes a schema-valid inventory with source dry-run", () => {
    const outDir = makeTempdir()
    const outPath = join(outDir, "legacy-inventory.dry-run.json")

    module.main({ dryRun: true, output: outPath })

    expect(existsSync(outPath)).toBe(true)
    const inv = JSON.parse(readFileSync(outPath, "utf8"))
    expect(inv.schemaVersion).toBe(1)
    expect(inv.source).toBe("dry-run")
    expect(inv.products["ellamaka-cli"]).toBeDefined()
    expect(inv.products["ellamaka-desktop"]).toBeDefined()
    expect(Array.isArray(inv.unparsable)).toBe(true)
  })

  test("classifyTag maps legacy shapes and standard shapes correctly", () => {
    // Legacy iteration shapes
    expect(module.classifyTag("v1.15.13-4")).toEqual({ kind: "legacy", shape: "stable-iteration" })
    expect(module.classifyTag("v1.15.13-1.rc2")).toEqual({ kind: "legacy", shape: "rc-iteration" })
    // New-standard namespaced tags
    expect(module.classifyTag("ellamaka-cli-v1.17.1")).toEqual({ kind: "standard" })
    expect(module.classifyTag("ellamaka-desktop-v1.16.2")).toEqual({ kind: "standard" })
    // Standard SemVer under generic namespace (pre-namespace era)
    expect(module.classifyTag("v1.15.13")).toEqual({ kind: "standard-shape", plain: "1.15.13" })
    expect(module.classifyTag("v1.15.13-beta.4")).toEqual({ kind: "standard-shape", plain: "1.15.13-beta.4" })
    // Truly unparsable
    expect(module.classifyTag("v1.14.39-dev")).toEqual({ kind: "unparsable" })
  })
})
