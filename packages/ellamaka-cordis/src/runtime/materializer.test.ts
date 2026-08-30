import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  checkClosureIntegrity,
  materializeClosure,
  validateClosureOnDisk,
  type MaterializeDeps,
} from "./materializer"
import type { DshRuntimeManifestV1 } from "./manifest"
import { closureNameForFingerprint, resolveDshLayout } from "./status"

const dirs: string[] = []

function tmpHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "dsh-mat-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const MANIFEST: DshRuntimeManifestV1 = {
  schema: "ellamaka.dsh-runtime/v1",
  bridgeAbi: 1,
  dependencies: {
    "@deepseek-ai/dsh": "0.1.1-rc.2",
    "@deepseek-ai/cordis": "4.0.1",
  },
  packageLock: {
    "@deepseek-ai/dsh": [
      "@deepseek-ai/dsh@0.1.1-rc.2",
      "https://registry.npmmirror.com/@deepseek-ai/dsh/-/dsh-0.1.1-rc.2.tgz",
      {},
      "sha512-abc123",
    ],
    "@deepseek-ai/cordis": [
      "@deepseek-ai/cordis@4.0.1",
      "https://registry.npmmirror.com/@deepseek-ai/cordis/-/cordis-4.0.1.tgz",
      {},
      "sha512-def456",
    ],
  },
  fingerprint: "sha256:9e1ee84dfdd992bf9ebb37c7506f13bc17b87158d02783c2b1b24fd25a32cda7",
}

/** A fake arborist whose reify synthesises closure node_modules in `home` staging. */
function fakeArborist(home: string, fail = false): NonNullable<MaterializeDeps["arborist"]> {
  return {
    create: async () => ({
      reify: async () => {
        if (fail) throw new Error("network down")
        const staging = resolveDshLayout(home).stagingDir
        for (const name of Object.keys(MANIFEST.dependencies)) {
          const dir = join(staging, "node_modules", ...name.split("/"))
          mkdirSync(dir, { recursive: true })
          writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.1.1-rc.2" }))
        }
      },
    }),
  }
}

/** Synthesise a complete, valid closure directory under a tmp home. */
function seedClosure(home: string, manifest = MANIFEST): string {
  const layout = resolveDshLayout(home)
  const closureDir = join(layout.closuresDir, closureNameForFingerprint(manifest.fingerprint!))
  mkdirSync(join(closureDir, "node_modules", "@deepseek-ai", "dsh"), { recursive: true })
  mkdirSync(join(closureDir, "node_modules", "@deepseek-ai", "cordis"), { recursive: true })
  writeFileSync(join(closureDir, "node_modules", "@deepseek-ai", "dsh", "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.1.1-rc.2" }))
  writeFileSync(join(closureDir, "node_modules", "@deepseek-ai", "cordis", "package.json"), JSON.stringify({ name: "@deepseek-ai/cordis", version: "4.0.1" }))
  writeFileSync(join(closureDir, "runtime-manifest.json"), JSON.stringify(manifest))
  writeFileSync(join(closureDir, "package.json"), JSON.stringify({ name: "ellamaka-dsh-closure", dependencies: manifest.dependencies }))
  writeFileSync(join(closureDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }))
  return join(closureDir, "node_modules", "@deepseek-ai", "dsh", "package.json")
}

describe("materializeClosure", () => {
  test("writes manifest+lock into staging, reifies, then activates into closures/<fingerprint>", async () => {
    const home = tmpHome()
    const result = await materializeClosure({ home, manifest: MANIFEST, deps: fakeArborist(home) })
    const closureDir = join(resolveDshLayout(home).closuresDir, closureNameForFingerprint(MANIFEST.fingerprint!))
    expect(result.anchor).toBe(join(closureDir, "node_modules", "@deepseek-ai", "dsh", "package.json"))
    expect(result.closureDir).toBe(closureDir)
    expect(existsSync(result.anchor)).toBe(true)
    expect(existsSync(join(closureDir, "runtime-manifest.json"))).toBe(true)
    expect(existsSync(join(closureDir, "package.json"))).toBe(true)
    expect(existsSync(join(closureDir, "package-lock.json"))).toBe(true)
    // staging is drained after a successful activate
    expect(existsSync(resolveDshLayout(home).stagingDir)).toBe(false)
  })

  test("reify failure leaves staging in place and rejects (no closure activated)", async () => {
    const home = tmpHome()
    await expect(materializeClosure({ home, manifest: MANIFEST, deps: fakeArborist(home, true) })).rejects.toThrow(/network down/)
    expect(existsSync(resolveDshLayout(home).stagingDir)).toBe(true)
    expect(existsSync(resolveDshLayout(home).closuresDir)).toBe(false)
  })

  test("does not overwrite an existing closure of the same fingerprint", async () => {
    const home = tmpHome()
    const anchor = seedClosure(home)
    const before = readFileSync(anchor, "utf8")
    const result = await materializeClosure({ home, manifest: MANIFEST, deps: fakeArborist(home) })
    expect(result.anchor).toBe(anchor)
    expect(readFileSync(anchor, "utf8")).toBe(before)
  })
})

describe("validateClosureOnDisk", () => {
  test("returns the anchor when the closure is complete", () => {
    const home = tmpHome()
    const anchor = seedClosure(home)
    expect(validateClosureOnDisk({ home, manifest: MANIFEST, deps: fakeArborist(home) })).toBe(anchor)
  })

  test("returns null when the closure is missing", () => {
    const home = tmpHome()
    expect(validateClosureOnDisk({ home, manifest: MANIFEST, deps: fakeArborist(home) })).toBeNull()
  })

  test("returns null when the anchor is damaged (missing dsh package.json)", () => {
    const home = tmpHome()
    const closureDir = join(resolveDshLayout(home).closuresDir, closureNameForFingerprint(MANIFEST.fingerprint!))
    mkdirSync(join(closureDir, "node_modules", "@deepseek-ai"), { recursive: true })
    writeFileSync(join(closureDir, "runtime-manifest.json"), JSON.stringify(MANIFEST))
    writeFileSync(join(closureDir, "package.json"), JSON.stringify({ name: "ellamaka-dsh-closure", dependencies: MANIFEST.dependencies }))
    writeFileSync(join(closureDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }))
    expect(validateClosureOnDisk({ home, manifest: MANIFEST, deps: fakeArborist(home) })).toBeNull()
  })

  test("returns null when a direct dependency package.json is missing", () => {
    const home = tmpHome()
    const closureDir = join(resolveDshLayout(home).closuresDir, closureNameForFingerprint(MANIFEST.fingerprint!))
    mkdirSync(join(closureDir, "node_modules", "@deepseek-ai", "dsh"), { recursive: true })
    writeFileSync(join(closureDir, "node_modules", "@deepseek-ai", "dsh", "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.1.1-rc.2" }))
    writeFileSync(join(closureDir, "runtime-manifest.json"), JSON.stringify(MANIFEST))
    writeFileSync(join(closureDir, "package.json"), JSON.stringify({ name: "ellamaka-dsh-closure", dependencies: MANIFEST.dependencies }))
    writeFileSync(join(closureDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }))
    expect(validateClosureOnDisk({ home, manifest: MANIFEST, deps: fakeArborist(home) })).toBeNull()
  })

  test("returns null when the closure manifest does not match the fingerprint", () => {
    const home = tmpHome()
    const other: DshRuntimeManifestV1 = {
      ...MANIFEST,
      dependencies: { "@deepseek-ai/dsh": "0.2.0" },
      fingerprint: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    }
    seedClosure(home, other)
    expect(validateClosureOnDisk({ home, manifest: MANIFEST, deps: fakeArborist(home) })).toBeNull()
  })
})

describe("checkClosureIntegrity", () => {
  test("resolves when integrity metadata is present and anchor files exist", async () => {
    const home = tmpHome()
    seedClosure(home)
    await expect(checkClosureIntegrity({ home, manifest: MANIFEST, deps: fakeArborist(home) })).resolves.toBeUndefined()
  })

  test("rejects when integrity metadata is present but the anchor is missing", async () => {
    const home = tmpHome()
    // no closure seeded
    await expect(checkClosureIntegrity({ home, manifest: MANIFEST, deps: fakeArborist(home) })).rejects.toThrow(/anchor|integrity/i)
  })
})
