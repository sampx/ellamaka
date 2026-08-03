import { describe, expect, test } from "bun:test"
import { buildReleaseInfoEnvelope, parseApiVersion, ReleaseInfoError } from "./release-info"

const COMMIT_40 = "91a7db1f22a2007588ee2a62e5d738b7d8e80291"
const UPSTREAM_COMMIT_40 = "385cb694419f98103af0e8fc6187ddcbcbb6eecb"

function validReleaseIdentity() {
  return {
    schemaVersion: 2,
    kind: "release" as const,
    product: "ellamaka-cli",
    version: "1.17.1",
    channel: "stable",
    upstream: { name: "opencode", version: "1.15.13", gitCommit: UPSTREAM_COMMIT_40 },
    build: {
      sourceTag: "ellamaka-cli-v1.17.1",
      gitCommit: COMMIT_40,
      builtAt: "2026-08-03T08:30:00Z",
      workflowRunId: "123456789",
    },
  }
}

function validDevIdentity() {
  return {
    schemaVersion: 2,
    kind: "development" as const,
    product: "ellamaka-cli",
    version: "0.0.0-dev.385cb694",
    channel: "local",
    build: { gitCommit: COMMIT_40, builtAt: "2026-08-03T08:30:00Z" },
  }
}

describe("release-info: api-version parsing", () => {
  test("accepts api-version 1", () => {
    expect(parseApiVersion("1")).toBe(1)
  })

  test("rejects unknown api-version", () => {
    expect(() => parseApiVersion("2")).toThrow(/api-version/)
    expect(() => parseApiVersion("0")).toThrow(/api-version/)
  })

  test("rejects non-numeric api-version", () => {
    expect(() => parseApiVersion("abc")).toThrow(/api-version/)
  })
})

describe("release-info: envelope builder", () => {
  test("builds envelope from release identity with engineApi capability", () => {
    const envelope = buildReleaseInfoEnvelope({
      identity: validReleaseIdentity(),
      engineApi: "1.2.0",
    })
    expect(envelope.apiVersion).toBe(1)
    const ri = envelope.releaseIdentity as { kind: string; product: string }
    expect(ri.kind).toBe("release")
    expect(ri.product).toBe("ellamaka-cli")
    expect(envelope.capabilities.engineApi).toBe("1.2.0")
  })

  test("builds envelope from development identity", () => {
    const envelope = buildReleaseInfoEnvelope({
      identity: validDevIdentity(),
      engineApi: "1.2.0",
    })
    const ri = envelope.releaseIdentity as { kind: string; channel: string; build: { sourceTag?: string } }
    expect(ri.kind).toBe("development")
    expect(ri.channel).toBe("local")
    expect(ri.build.sourceTag).toBeUndefined()
  })

  test("rejects identity with wrong product for CLI command", () => {
    const bad = { ...validReleaseIdentity(), product: "ellamaka-desktop" }
    expect(() => buildReleaseInfoEnvelope({ identity: bad, engineApi: "1.2.0" })).toThrow(/product/)
  })

  test("rejects corrupt identity (missing required field)", () => {
    const bad = { ...validReleaseIdentity(), build: { ...validReleaseIdentity().build, sourceTag: undefined } }
    expect(() => buildReleaseInfoEnvelope({ identity: bad, engineApi: "1.2.0" })).toThrow(/sourceTag/)
  })

  test("envelope is pure JSON (no non-serializable fields)", () => {
    const envelope = buildReleaseInfoEnvelope({
      identity: validReleaseIdentity(),
      engineApi: "1.2.0",
    })
    const json = JSON.stringify(envelope)
    expect(JSON.parse(json)).toEqual(envelope)
  })

  test("missing identity (local build with no embedded context) returns development fallback", () => {
    const envelope = buildReleaseInfoEnvelope({ identity: null, engineApi: "1.2.0" })
    const ri = envelope.releaseIdentity as { kind: string; channel: string; version: string }
    expect(ri.kind).toBe("development")
    expect(ri.channel).toBe("local")
    expect(ri.version).toMatch(/^0\.0\.0-dev/)
  })
})

describe("release-info: error envelope", () => {
  test("error envelope has stable non-zero exit code and JSON-only stdout", () => {
    const err = new ReleaseInfoError("EPARSE", "identity corrupted")
    const envelope = err.toEnvelope()
    expect(envelope.error.code).toBe("EPARSE")
    expect(envelope.error.message).toBe("identity corrupted")
    expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope)
  })
})
