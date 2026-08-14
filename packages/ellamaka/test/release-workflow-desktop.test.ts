import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"

const currentDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(currentDir, "..", "..", "..")
const workflow = readFileSync(join(root, ".github", "workflows", "publish-ellamaka-desktop.yml"), "utf8")
const builderConfig = readFileSync(join(root, "packages", "ellamaka-desktop", "electron-builder.config.ts"), "utf8")
const finalizeScript = readFileSync(join(root, "packages", "ellamaka-desktop", "scripts", "finalize-latest-json.ts"), "utf8")

describe("publish-ellamaka-desktop workflow", () => {
  test("uploads the versioned set driven by the manifest declaration", () => {
    // The uploaded set equals the declared set by construction; dist globs
    // must not drive versioned uploads.
    expect(workflow).toContain("Uploading versioned artifacts (declared set)...")
    expect(workflow).toContain('put_with_cache "dist/${name}" "${VERSION_PREFIX}/${name}"')
    expect(workflow).toContain('console.log([a.name, a.ext].join("\\t"))')
  })

  test("verifies versioned uploads against the manifest, not local dist files", () => {
    expect(workflow).toContain("Verifying R2 uploads against manifest...")
    expect(workflow).toContain("ERROR: manifest artifact missing sha256/size: $mname")
    expect(workflow).toContain("manifest_sha")
    expect(workflow).toContain("manifest_size")
    expect(workflow).toContain('while IFS=$\'\\t\' read -r name ext; do')
  })

  test("promotes latest aliases only after versioned verification passes", () => {
    // A failed verify must never point the beta/stable latest channel at a
    // broken release. Previously the aliases were written before verify.
    const verifyIdx = workflow.indexOf("Verifying R2 uploads against manifest...")
    const manifestIdx = workflow.indexOf("promoted latest manifest: ${LATEST_PREFIX}/manifest.json")
    const feedIdx = workflow.indexOf("promoted feed: ${LATEST_PREFIX}/${feed}")
    expect(verifyIdx).toBeGreaterThan(-1)
    expect(manifestIdx).toBeGreaterThan(verifyIdx)
    expect(feedIdx).toBeGreaterThan(verifyIdx)
  })

  test("no longer produces or uploads rpm packages", () => {
    expect(workflow).not.toMatch(/\*\.rpm/)
    expect(workflow).not.toContain("application/x-rpm")
    expect(builderConfig).toContain('target: ["AppImage", "deb"]')
    expect(builderConfig).not.toMatch(/rpm/)
    expect(finalizeScript).not.toMatch(/\.rpm/)
  })
})
