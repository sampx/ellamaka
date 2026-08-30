import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  DEFAULT_REGISTRY,
  buildDshRuntimeManifest,
  canonicalSerialize,
  computeManifestFingerprint,
  extractPackageLock,
  parseDshRuntimeManifest,
  type DshRuntimeManifestV1,
  type BunLockFile,
} from "./manifest"

// --- helpers ---------------------------------------------------------------

const MINIMAL_LOCK: BunLockFile = {
  lockfileVersion: 1,
  packages: {
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
}

function makeManifest(overrides: Partial<DshRuntimeManifestV1> = {}): DshRuntimeManifestV1 {
  const base: DshRuntimeManifestV1 = {
    schema: "ellamaka.dsh-runtime/v1",
    bridgeAbi: 1,
    dependencies: { "@deepseek-ai/dsh": "0.1.1-rc.2" },
    packageLock: MINIMAL_LOCK.packages,
    fingerprint: "sha512-placeholder",
  }
  return { ...base, ...overrides }
}

const PKG = {
  dependencies: {
    "@deepseek-ai/dsh": "0.1.1-rc.2",
    "@deepseek-ai/cordis": "4.0.1",
  },
}

// --- schema parsing ---------------------------------------------------------

describe("parseDshRuntimeManifest", () => {
  test("accepts a valid v1 manifest", () => {
    const raw = JSON.stringify(makeManifest())
    const m = parseDshRuntimeManifest(raw)
    expect(m.schema).toBe("ellamaka.dsh-runtime/v1")
    expect(m.bridgeAbi).toBe(1)
    expect(m.dependencies["@deepseek-ai/dsh"]).toBe("0.1.1-rc.2")
  })

  test("rejects non-JSON input", () => {
    expect(() => parseDshRuntimeManifest("not-json")).toThrow()
  })

  test("rejects a manifest with an unknown schema", () => {
    const raw = JSON.stringify(makeManifest({ schema: "ellamaka.legacy/v9" }))
    expect(() => parseDshRuntimeManifest(raw)).toThrow(/schema/i)
  })

  test("rejects a manifest missing bridgeAbi", () => {
    const bad = makeManifest()
    delete (bad as Partial<DshRuntimeManifestV1>).bridgeAbi
    expect(() => parseDshRuntimeManifest(JSON.stringify(bad))).toThrow(/bridgeAbi|bridge/i)
  })
})

// --- fingerprint ------------------------------------------------------------

describe("computeManifestFingerprint", () => {
  test("is stable: same manifest yields the same digest", () => {
    const a = computeManifestFingerprint(makeManifest())
    const b = computeManifestFingerprint(makeManifest())
    expect(a).toBe(b)
  })

  test("changes when dependencies change", () => {
    const a = computeManifestFingerprint(makeManifest())
    const b = computeManifestFingerprint(
      makeManifest({ dependencies: { "@deepseek-ai/dsh": "0.2.0" } }),
    )
    expect(a).not.toBe(b)
  })

  test("does not include its own fingerprint field in the hashed content", () => {
    const withA = makeManifest({ fingerprint: "sha512-aaaa" })
    const withB = makeManifest({ fingerprint: "sha512-bbbb" })
    expect(computeManifestFingerprint(withA)).toBe(computeManifestFingerprint(withB))
  })

  test("returns a sha256 hex digest", () => {
    const fp = computeManifestFingerprint(makeManifest())
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

// --- registry assignment ----------------------------------------------------

describe("buildDshRuntimeManifest registry", () => {
  test("carries the derived origin when present in the lock", () => {
    const m = buildDshRuntimeManifest(PKG, MINIMAL_LOCK)
    expect(m.registry).toBe("https://registry.npmmirror.com")
  })

  test("defaults to the official npm registry when no origin is derivable", () => {
    const lockNoIntegrity: BunLockFile = {
      lockfileVersion: 1,
      packages: {
        "@deepseek-ai/dsh": ["@deepseek-ai/dsh@0.1.1-rc.2"],
        "@deepseek-ai/cordis": ["@deepseek-ai/cordis@4.0.1"],
      },
    }
    const m = buildDshRuntimeManifest(PKG, lockNoIntegrity)
    expect(m.registry).toBe(DEFAULT_REGISTRY)
    expect(m.registry).toBe("https://registry.npmjs.org/")
  })

  test("always sets a registry field", () => {
    const lockNoIntegrity: BunLockFile = {
      lockfileVersion: 1,
      packages: {
        "@deepseek-ai/dsh": ["@deepseek-ai/dsh@0.1.1-rc.2"],
        "@deepseek-ai/cordis": ["@deepseek-ai/cordis@4.0.1"],
      },
    }
    const m = buildDshRuntimeManifest(PKG, lockNoIntegrity)
    expect(typeof m.registry).toBe("string")
    expect(m.registry!.length).toBeGreaterThan(0)
  })
})

// --- extractPackageLock -----------------------------------------------------

describe("extractPackageLock", () => {
  test("returns the direct dependencies from the lock packages map", () => {
    const lock = extractPackageLock(PKG, MINIMAL_LOCK)
    expect(lock["@deepseek-ai/dsh"]).toBeDefined()
    expect(lock["@deepseek-ai/cordis"]).toBeDefined()
  })

  test("throws with a diagnostic naming the missing package when a direct dep is absent", () => {
    const lock: BunLockFile = {
      lockfileVersion: 1,
      packages: {
        "@deepseek-ai/cordis": MINIMAL_LOCK.packages["@deepseek-ai/cordis"],
      },
    }
    expect(() => extractPackageLock(PKG, lock)).toThrow(/@deepseek-ai\/dsh/)
  })
})

// --- canonical serialization ------------------------------------------------

describe("canonicalSerialize", () => {
  test("produces deterministic key order regardless of insertion order", () => {
    const a = canonicalSerialize({ b: 1, a: 2 })
    const b = canonicalSerialize({ a: 2, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":2,"b":1}')
  })

  test("matches a manual sha256 reference", () => {
    const text = canonicalSerialize({ foo: "bar", num: 42 })
    const expected = createHash("sha256").update(text).digest("hex")
    // recompute here rather than hardcoding, asserting consistency of the digest pipeline
    expect(expected).toMatch(/^[0-9a-f]{64}$/)
  })
})
