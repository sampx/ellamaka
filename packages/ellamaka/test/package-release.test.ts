import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"

const script = await import("../../../scripts/package-release.mjs")
const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(currentDir, "fixtures", "release-archives")
const tempDirs: string[] = []
const defaultBaseUrl = "https://download.coursedao.com/ellamaka"
const platformArtifacts = [
  { platform: "darwin-arm64", artifact: "ellamaka-darwin-arm64.tar.gz" },
  { platform: "darwin-x64", artifact: "ellamaka-darwin-x64.tar.gz" },
  { platform: "linux-x64", artifact: "ellamaka-linux-x64.tar.gz" },
  { platform: "windows-x64", artifact: "ellamaka-windows-x64.zip" },
]

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs.length = 0
})

function makeTempdir() {
  const dir = mkdtempSync(join(tmpdir(), "ellamaka-package-release-test-"))
  tempDirs.push(dir)
  return dir
}

function computeSha256(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

function generate(outputDir: string, baseUrl = defaultBaseUrl) {
  script.manifestCommand({
    archivesDir: fixturesDir,
    version: "0.1.0-test",
    outputDir,
    tag: "v0.1.0-test",
    baseUrl,
  })
}

describe("package-release.mjs", () => {
  test("maps the 4 P1 platforms to the stable artifact names", () => {
    expect(platformArtifacts.map((item) => item.artifact).sort()).toEqual(
      [
        "ellamaka-darwin-arm64.tar.gz",
        "ellamaka-darwin-x64.tar.gz",
        "ellamaka-linux-x64.tar.gz",
        "ellamaka-windows-x64.zip",
      ].sort(),
    )
  })

  test("parses ellamaka archive names", () => {
    expect(script.parseArchiveName("ellamaka-darwin-arm64.tar.gz")).toEqual({
      os: "darwin",
      arch: "arm64",
      variant: null,
      ext: "tar.gz",
      product: "cli",
    })
    expect(script.parseArchiveName("ellamaka-windows-x64.zip")).toEqual({
      os: "windows",
      arch: "x64",
      variant: null,
      ext: "zip",
      product: "cli",
    })
  })

  test("parses ellamaka-desktop archive names", () => {
    expect(script.parseArchiveName("ellamaka-desktop-darwin-arm64.dmg")).toEqual({
      os: "darwin",
      arch: "arm64",
      variant: null,
      ext: "dmg",
      product: "desktop",
    })
    expect(script.parseArchiveName("ellamaka-desktop-win32-x64.exe")).toEqual({
      os: "windows",
      arch: "x64",
      variant: null,
      ext: "exe",
      product: "desktop",
    })
    expect(script.parseArchiveName("ellamaka-desktop-linux-x64.AppImage")).toEqual({
      os: "linux",
      arch: "x64",
      variant: null,
      ext: "AppImage",
      product: "desktop",
    })
    expect(script.parseArchiveName("ellamaka-desktop-linux-x64.deb")).toEqual({
      os: "linux",
      arch: "x64",
      variant: null,
      ext: "deb",
      product: "desktop",
    })
  })

  test("normalizes electron-builder arch names to x64", () => {
    // electron-builder uses platform-specific arch names for linux:
    // amd64 (deb), x86_64 (AppImage, rpm). Both must normalize to x64.
    expect(script.parseArchiveName("ellamaka-desktop-linux-amd64.deb")).toEqual({
      os: "linux",
      arch: "x64",
      variant: null,
      ext: "deb",
      product: "desktop",
    })
    expect(script.parseArchiveName("ellamaka-desktop-linux-x86_64.AppImage")).toEqual({
      os: "linux",
      arch: "x64",
      variant: null,
      ext: "AppImage",
      product: "desktop",
    })
    expect(script.parseArchiveName("ellamaka-desktop-linux-x86_64.rpm")).toEqual({
      os: "linux",
      arch: "x64",
      variant: null,
      ext: "rpm",
      product: "desktop",
    })
  })

  test("generates manifest.json with R2 URLs", () => {
    const outputDir = resolve(makeTempdir(), "output")
    generate(outputDir)
    const manifest = JSON.parse(readFileSync(join(outputDir, "manifest.json"), "utf8"))

    expect(manifest.version).toBe("0.1.0-test")
    expect(manifest.artifacts).toHaveLength(4)
    expect(manifest.checksumsUrl).toBe(`${defaultBaseUrl}/v0.1.0-test/checksums.txt`)

    for (const artifact of manifest.artifacts) {
      expect(artifact.name).toMatch(/^ellamaka-.*\.(tar\.gz|zip)$/)
      expect(artifact.url).toBe(`${defaultBaseUrl}/v0.1.0-test/${artifact.name}`)
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(artifact.size).toBeGreaterThan(0)
      expect(artifact.variant).toBeNull()
    }
  })

  test("generates manifest with desktop products", () => {
    const desktopArchives = makeTempdir()
    for (const name of [
      "ellamaka-desktop-darwin-arm64.dmg",
      "ellamaka-desktop-win32-x64.exe",
      "ellamaka-desktop-linux-x64.AppImage",
    ]) {
      writeFileSync(join(desktopArchives, name), `fake-desktop-binary-${name}`)
    }
    const outputDir = resolve(makeTempdir(), "output")
    script.manifestCommand({
      archivesDir: desktopArchives,
      version: "0.1.0-desktop",
      outputDir,
      tag: "v0.1.0-desktop",
      baseUrl: "https://download.coursedao.com/ellamaka-desktop",
    })

    const manifest = JSON.parse(readFileSync(join(outputDir, "manifest.json"), "utf8"))
    expect(manifest.artifacts).toHaveLength(3)
    for (const artifact of manifest.artifacts) {
      expect(artifact.name).toMatch(/^ellamaka-desktop-.*\.(dmg|exe|AppImage|deb|rpm)$/)
      expect(artifact.url).toBe(`https://download.coursedao.com/ellamaka-desktop/v0.1.0-desktop/${artifact.name}`)
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(artifact.size).toBeGreaterThan(0)
      expect(artifact.product).toBe("desktop")
    }
  })

  test("accepts a custom base URL", () => {    const outputDir = resolve(makeTempdir(), "output")
    generate(outputDir, "https://example.com/ellamaka")
    const manifest = JSON.parse(readFileSync(join(outputDir, "manifest.json"), "utf8"))

    for (const artifact of manifest.artifacts) expect(artifact.url).toBe(`https://example.com/ellamaka/v0.1.0-test/${artifact.name}`)
    expect(manifest.checksumsUrl).toBe("https://example.com/ellamaka/v0.1.0-test/checksums.txt")
  })

  test("generates checksums that match the archive files", () => {
    const outputDir = resolve(makeTempdir(), "output")
    generate(outputDir)
    const lines = readFileSync(join(outputDir, "checksums.txt"), "utf8").trim().split("\n")

    expect(lines).toHaveLength(4)
    for (const line of lines) {
      const match = line.match(/^([a-f0-9]{64})  (.+)$/)
      expect(match).not.toBeNull()
      const filename = match?.[2] ?? ""
      expect(existsSync(join(fixturesDir, filename))).toBe(true)
      expect(match?.[1]).toBe(computeSha256(join(fixturesDir, filename)))
    }
  })

  test("generates release notes with download and verification links", () => {
    const outputDir = resolve(makeTempdir(), "output")
    generate(outputDir)
    const notes = readFileSync(join(outputDir, "release-notes.md"), "utf8")

    expect(notes).not.toContain("# ellamaka v0.1.0-test")
    expect(notes).toContain("## Downloads")
    expect(notes).toContain(`${defaultBaseUrl}/v0.1.0-test/manifest.json`)
    expect(notes).toContain(`${defaultBaseUrl}/v0.1.0-test/checksums.txt`)
    for (const item of platformArtifacts) expect(notes).toContain(`${defaultBaseUrl}/v0.1.0-test/${item.artifact}`)
  })
})
