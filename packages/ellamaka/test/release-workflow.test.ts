import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"

const currentDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(currentDir, "..", "..", "..")
const workflow = readFileSync(join(root, ".github", "workflows", "publish-ellamaka.yml"), "utf8")

function count(text: string, needle: string) {
  return text.split(needle).length - 1
}

describe("publish-ellamaka workflow", () => {
  test("builds release binaries with release channel and archives the 4 P1 artifacts", () => {
    expect(workflow).toContain("OPENCODE_RELEASE: ${{ needs.version.outputs.release }}")
    expect(workflow).toContain("bash scripts/build.sh cli --arch primary --web-ui \"${WEB_UI}\"")
    expect(workflow).toContain("ellamaka-darwin-arm64.tar.gz")
    expect(workflow).toContain("ellamaka-darwin-x64.tar.gz")
    expect(workflow).toContain("ellamaka-linux-x64.tar.gz")
    expect(workflow).toContain("ellamaka-windows-x64.zip")
    expect(workflow).not.toContain("dist/ellamaka-darwin-arm64.zip")
    expect(workflow).not.toContain("dist/ellamaka-darwin-x64.zip")
  })

  test("selects the embedded web UI during manual dispatch", () => {
    expect(workflow).toContain("web_ui:")
    expect(workflow).toContain("default: \"ellamaka-app\"")
    expect(workflow).toContain("- ellamaka-app")
    expect(workflow).toContain("- app")
    expect(workflow).toContain("- none")
    expect(workflow).toContain("WEB_UI: ${{ github.event.inputs.web_ui || 'ellamaka-app' }}")
  })

  test("generates metadata and uploads binaries to R2", () => {
    expect(workflow).toContain("node scripts/package-release.mjs manifest")
    expect(workflow).toContain("--tag v\"$VERSION\"")
    expect(workflow).toContain('VERSION_PREFIX="ellamaka/v${VERSION}"')
    expect(workflow).toContain('aws s3 rm "s3://wopal-release/${VERSION_PREFIX}/"')
    expect(workflow).toContain("ellamaka/latest/manifest.json")
    expect(workflow).not.toContain("ellamaka/latest/checksums.txt")
    expect(workflow).not.toContain("ellamaka/latest/release-notes.md")
  })

  test("deletes R2 object before put-object to avoid stale truncated residue", () => {
    expect(workflow).toContain("aws s3api delete-object")
    expect(workflow).toContain("aws s3api put-object")
    // Retry on put-object failure for large archives
    expect(workflow).toMatch(/for attempt in 1 2 3[\s\S]*put-object/)
  })

  test("verifies R2 uploads against manifest hashes (not local dist files)", () => {
    // The manifest is the source of truth for install-time checksum verification.
    // Comparing against local dist files can pass when both are identically
    // corrupted; comparing against the manifest catches that case.
    expect(workflow).toContain("Verifying R2 uploads against manifest...")
    expect(workflow).toContain("manifest_sha")
    expect(workflow).toContain("manifest_size")
    expect(workflow).toContain("head-object")
    expect(workflow).toContain("expected_hash")
    expect(workflow).not.toContain("local  sha256")
    expect(workflow).not.toContain("local_hash")
  })

  test("purges CDN cache for latest alias and release artifacts", () => {
    // Re-publishing the same release version requires evicting versioned
    // metadata and artifact URLs, otherwise CDN edges can serve stale bytes.
    expect(workflow).toContain("Purge Cloudflare CDN cache")
    expect(workflow).toContain("CLOUDFLARE_CACHE_PURGE_TOKEN")
    expect(workflow).toContain("CLOUDFLARE_CACHE_PURGE_ZONE")
    expect(workflow).toContain("old-cli-release-urls")
    expect(workflow).toContain("offset+=30")
    expect(workflow).toContain("ellamaka/latest/manifest.json")
    expect(workflow).toContain("ellamaka/v${VERSION}/manifest.json")
    expect(workflow).toContain("for (const a of m.artifacts) console.log(a.url)")
    expect(workflow).not.toContain("purge_everything")
  })

  test("creates 4 markdown-only release entries", () => {
    expect(workflow).toContain("wopal-cn/ellamaka")
    expect(workflow).toContain("wopal-cn/wopal-space-ontology")
    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}")
    expect(workflow).toContain("RELEASE_TOKEN secret is required to publish the ontology GitHub release.")
    expect(workflow).toContain("--notes-file release-output/release-notes.md")
    expect(count(workflow, "node scripts/create-gitee-release.mjs")).toBe(2)
    expect(count(workflow, "--repo wopal-cn/ellamaka")).toBeGreaterThanOrEqual(2)
    expect(count(workflow, "--repo wopal-cn/wopal-space-ontology")).toBeGreaterThanOrEqual(2)
    expect(workflow).not.toContain("gh release upload")
    expect(workflow).not.toContain("--generate-notes")
  })
})
