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
    expect(workflow).toContain("ellamaka-darwin-arm64.tar.gz")
    expect(workflow).toContain("ellamaka-darwin-x64.tar.gz")
    expect(workflow).toContain("ellamaka-linux-x64.tar.gz")
    expect(workflow).toContain("ellamaka-windows-x64.zip")
    expect(workflow).not.toContain("dist/ellamaka-darwin-arm64.zip")
    expect(workflow).not.toContain("dist/ellamaka-darwin-x64.zip")
  })

  test("generates metadata and uploads binaries to R2", () => {
    expect(workflow).toContain("node scripts/package-release.mjs manifest")
    expect(workflow).toContain("--tag v\"$VERSION\"")
    expect(workflow).toContain("s3://wopal-release/ellamaka/v${VERSION}")
    expect(workflow).toContain("s3://wopal-release/ellamaka/latest")
    expect(workflow).toContain("max-age=604800")
    expect(workflow).toContain("max-age=300")
    expect(workflow).toContain("${LATEST_KEY}/manifest.json")
    expect(workflow).not.toContain("${LATEST_KEY}/checksums.txt")
    expect(workflow).not.toContain("${LATEST_KEY}/release-notes.md")
  })

  test("creates 4 markdown-only release entries", () => {
    expect(workflow).toContain("wopal-cn/ellamaka")
    expect(workflow).toContain("wopal-cn/wopal-space-ontology")
    expect(workflow).toContain("--notes-file release-output/release-notes.md")
    expect(count(workflow, "node scripts/create-gitee-release.mjs")).toBe(2)
    expect(count(workflow, "--repo wopal-cn/ellamaka")).toBeGreaterThanOrEqual(2)
    expect(count(workflow, "--repo wopal-cn/wopal-space-ontology")).toBeGreaterThanOrEqual(2)
    expect(workflow).not.toContain("gh release upload")
    expect(workflow).not.toContain("--generate-notes")
  })
})
