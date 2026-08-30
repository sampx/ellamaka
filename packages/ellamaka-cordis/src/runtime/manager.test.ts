import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initializeDshRuntime, type InitializeDshOptions, type ManagerDeps } from "./manager"
import type { DshRuntimeManifestV1 } from "./manifest"
import { closureNameForFingerprint, resolveDshLayout } from "./status"

const dirs: string[] = []

function tmpHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "dsh-mgr-"))
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

/** Fake arborist that synthesises a full closure node_modules in `home` staging. */
function fakeArborist(home: string, reifyHook?: () => void | Promise<void>): ManagerDeps["arborist"] {
  return {
    create: async () => ({
      reify: async () => {
        if (reifyHook) await reifyHook()
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

function makeBaseOptions(home: string, overrides: Partial<InitializeDshOptions> = {}): InitializeDshOptions {
  return {
    wopalHome: home,
    logFile: join(home, "logs", "dsh.log"),
    entry: "serve",
    manifest: MANIFEST,
    ...overrides,
  }
}

/** Seed a complete valid closure for the default fingerprint under a tmp home. */
function seedClosure(home: string): string {
  return seedClosureAt(home, MANIFEST)
}

/** Seed a complete valid closure for an arbitrary manifest. */
function seedClosureAt(home: string, manifest: DshRuntimeManifestV1): string {
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

describe("initializeDshRuntime state machine", () => {
  test("ELLAMAKA_DSH=0 -> disabled with zero file access", async () => {
    const home = tmpHome()
    const options = makeBaseOptions(home, {
      deps: {
        fetch: async () => {
          throw new Error("must not fetch")
        },
      },
    })
    const status = await initializeDshRuntime({ ...options, env: { ELLAMAKA_DSH: "0" } })
    expect(status).toBe("disabled")
    expect(existsSync(resolveDshLayout(home).dshHome)).toBe(false)
  })

  test("target closure already materialised -> ready without any network fetch", async () => {
    const home = tmpHome()
    seedClosure(home)
    const fetchSpy = async () => {
      throw new Error("must not fetch")
    }
    const status = await initializeDshRuntime(makeBaseOptions(home, { deps: { fetch: fetchSpy } }))
    expect(status).toBe("ready")
  })

  test("missing closure -> hold lock, reify, verify, activate, ready", async () => {
    const home = tmpHome()
    const status = await initializeDshRuntime(makeBaseOptions(home, { deps: { arborist: fakeArborist(home) } }))
    expect(status).toBe("ready")
    const closureDir = join(resolveDshLayout(home).closuresDir, closureNameForFingerprint(MANIFEST.fingerprint!))
    expect(existsSync(closureDir)).toBe(true)
    expect(existsSync(join(closureDir, "node_modules", "@deepseek-ai", "dsh", "package.json"))).toBe(true)
  })

  test("reify failure -> degraded and never overwrites a working closure", async () => {
    const home = tmpHome()
    // Seed a working closure for a DIFFERENT fingerprint (the one in use).
    const otherManifest: DshRuntimeManifestV1 = {
      ...MANIFEST,
      dependencies: { "@deepseek-ai/dsh": "0.2.0" },
      fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }
    const existingAnchor = seedClosureAt(home, otherManifest)
    const failingArborist: ManagerDeps["arborist"] = {
      create: async () => ({
        reify: async () => {
          throw new Error("arborist exploded")
        },
      }),
    }
    const status = await initializeDshRuntime(makeBaseOptions(home, { deps: { arborist: failingArborist } }))
    expect(status).toBe("degraded")
    expect(existsSync(existingAnchor)).toBe(true)
  })

  test("damaged closure (anchor missing) is treated as missing and re-materialised", async () => {
    const home = tmpHome()
    const closureDir = join(resolveDshLayout(home).closuresDir, closureNameForFingerprint(MANIFEST.fingerprint!))
    mkdirSync(join(closureDir, "node_modules", "@deepseek-ai"), { recursive: true })
    writeFileSync(join(closureDir, "runtime-manifest.json"), JSON.stringify(MANIFEST))
    writeFileSync(join(closureDir, "package.json"), JSON.stringify({ name: "ellamaka-dsh-closure", dependencies: MANIFEST.dependencies }))
    writeFileSync(join(closureDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }))

    const status = await initializeDshRuntime(makeBaseOptions(home, { deps: { arborist: fakeArborist(home) } }))
    expect(status).toBe("ready")
    expect(existsSync(join(closureDir, "node_modules", "@deepseek-ai", "dsh", "package.json"))).toBe(true)
  })

  test("concurrent calls: one reifies, the other waits then resolves ready", async () => {
    const home = tmpHome()
    const calls: string[] = []
    const gated: ManagerDeps["arborist"] = {
      create: async () => ({
        reify: async () => {
          calls.push("reify")
          const staging = resolveDshLayout(home).stagingDir
          for (const name of Object.keys(MANIFEST.dependencies)) {
            const dir = join(staging, "node_modules", ...name.split("/"))
            mkdirSync(dir, { recursive: true })
            writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.1.1-rc.2" }))
          }
        },
      }),
    }
    const options = makeBaseOptions(home, { deps: { arborist: gated } })
    const [a, b] = await Promise.all([initializeDshRuntime(options), initializeDshRuntime(options)])
    expect(a).toBe("ready")
    expect(b).toBe("ready")
    expect(calls.filter((c) => c === "reify").length).toBe(1)
  })

  test("idempotent: two sequential calls both resolve ready", async () => {
    const home = tmpHome()
    const options = makeBaseOptions(home, { deps: { arborist: fakeArborist(home) } })
    expect(await initializeDshRuntime(options)).toBe("ready")
    expect(await initializeDshRuntime(options)).toBe("ready")
  })

  test("ready closure exposes an installAnchor that loader can resolve", async () => {
    const home = tmpHome()
    const status = await initializeDshRuntime(makeBaseOptions(home, { deps: { arborist: fakeArborist(home) } }))
    expect(status).toBe("ready")
    // The installed anchor exists and createClosureRequire can read the dsh package.json.
    const anchor = join(
      resolveDshLayout(home).closuresDir,
      closureNameForFingerprint(MANIFEST.fingerprint!),
      "node_modules", "@deepseek-ai", "dsh", "package.json",
    )
    expect(existsSync(anchor)).toBe(true)
  })

  test("staged verification failure (invalid installAnchor) -> degraded, staging kept", async () => {
    const home = tmpHome()
    // Fake arborist that writes a staging node_modules WITHOUT the @deepseek-ai/dsh anchor.
    const badReify: ManagerDeps["arborist"] = {
      create: async () => ({
        reify: async () => {
          const staging = resolveDshLayout(home).stagingDir
          mkdirSync(join(staging, "node_modules", "@deepseek-ai", "cordis"), { recursive: true })
          writeFileSync(join(staging, "node_modules", "@deepseek-ai", "cordis", "package.json"), JSON.stringify({ name: "@deepseek-ai/cordis" }))
        },
      }),
    }
    const status = await initializeDshRuntime(makeBaseOptions(home, { deps: { arborist: badReify } }))
    expect(status).toBe("degraded")
    // The failed staging scene is kept for diagnosis, and no closure was activated.
    expect(existsSync(resolveDshLayout(home).stagingDir)).toBe(true)
    expect(existsSync(resolveDshLayout(home).closuresDir)).toBe(false)
  })

  test("materialisation timeout -> degraded with no retry this launch", async () => {
    const home = tmpHome()
    // Fake arborist that hangs forever; the short injectable timeout must cut it off.
    const hanging: ManagerDeps["arborist"] = {
      create: async () => ({
        reify: async () => {
          await new Promise<void>(() => {}) // never resolves
        },
      }),
    }
    const status = await initializeDshRuntime(
      makeBaseOptions(home, { deps: { arborist: hanging }, timeoutMs: 80 }),
    )
    expect(status).toBe("degraded")
    expect(existsSync(resolveDshLayout(home).closuresDir)).toBe(false)
  })
})
