import { describe, expect, test } from "bun:test"
import { checkVersionCompatibility, parseReleaseIdentity, type ReleaseIdentity } from "./version-compat"

const COMMIT_40 = "91a7db1f22a2007588ee2a62e5d738b7d8e80291"
const UPSTREAM_COMMIT_40 = "385cb694419f98103af0e8fc6187ddcbcbb6eecb"

function validCliIdentity(version = "1.17.1", channel = "stable"): ReleaseIdentity {
  return {
    schemaVersion: 2,
    kind: "release",
    product: "ellamaka-cli",
    version,
    channel,
    upstream: { name: "opencode", version: "1.15.13", gitCommit: UPSTREAM_COMMIT_40 },
    build: {
      sourceTag: `ellamaka-cli-v${version}`,
      gitCommit: COMMIT_40,
      builtAt: "2026-08-03T08:30:00Z",
      workflowRunId: "123456789",
    },
  }
}

function validDesktopRequirements() {
  return {
    externalCli: {
      product: "ellamaka-cli",
      channel: "stable",
      engineApi: ">=1.2.0 <2.0.0",
      upstreamBaseline: "1.15.13",
      selection: "latest",
    },
    wopalCli: ">=0.3.8",
  }
}

describe("version-compat: parseReleaseIdentity", () => {
  test("parses a valid release identity", () => {
    const id = parseReleaseIdentity(validCliIdentity())
    expect(id.product).toBe("ellamaka-cli")
    expect(id.channel).toBe("stable")
  })

  test("rejects identity with invalid kind", () => {
    const bad = { ...validCliIdentity(), kind: "staging" }
    expect(() => parseReleaseIdentity(bad as unknown as ReleaseIdentity)).toThrow(/kind/)
  })
})

describe("version-compat: CLI/Desktop compatibility gate", () => {
  test("accepts compatible CLI stable latest", () => {
    const cli = validCliIdentity("1.17.1", "stable")
    const result = checkVersionCompatibility({
      cliIdentity: cli,
      cliEngineApi: "1.2.0",
      desktopRequirements: validDesktopRequirements(),
    })
    expect(result.compatible).toBe(true)
  })

  test("rejects CLI with wrong product", () => {
    const cli = { ...validCliIdentity(), product: "ellamaka-desktop" }
    const result = checkVersionCompatibility({
      cliIdentity: cli as unknown as ReleaseIdentity,
      cliEngineApi: "1.2.0",
      desktopRequirements: validDesktopRequirements(),
    })
    expect(result.compatible).toBe(false)
    expect(result.reason).toMatch(/product/)
  })

  test("rejects CLI with wrong channel (beta when stable required)", () => {
    const cli = validCliIdentity("1.17.0-beta.1", "beta")
    const result = checkVersionCompatibility({
      cliIdentity: cli,
      cliEngineApi: "1.2.0",
      desktopRequirements: validDesktopRequirements(),
    })
    expect(result.compatible).toBe(false)
    expect(result.reason).toMatch(/channel/)
  })

  test("rejects CLI with mismatched upstream baseline", () => {
    const cli = { ...validCliIdentity(), upstream: { ...validCliIdentity().upstream, version: "1.16.0" } }
    const result = checkVersionCompatibility({
      cliIdentity: cli as unknown as ReleaseIdentity,
      cliEngineApi: "1.2.0",
      desktopRequirements: validDesktopRequirements(),
    })
    expect(result.compatible).toBe(false)
    expect(result.reason).toMatch(/upstream/)
  })

  test("rejects CLI with incompatible engineApi", () => {
    const result = checkVersionCompatibility({
      cliIdentity: validCliIdentity(),
      cliEngineApi: "0.9.0",
      desktopRequirements: validDesktopRequirements(),
    })
    expect(result.compatible).toBe(false)
    expect(result.reason).toMatch(/engineApi/)
  })

  test("v2 omits upstreamBaseline: only checks product/channel/engineApi", () => {
    const v2Requirements = {
      externalCli: {
        product: "ellamaka-cli",
        channel: "stable",
        engineApi: ">=1.2.0 <2.0.0",
        selection: "latest",
      },
      wopalCli: ">=0.3.8",
    }
    const cli = { ...validCliIdentity(), upstream: { ...validCliIdentity().upstream, version: "9.9.9" } }
    const result = checkVersionCompatibility({
      cliIdentity: cli as unknown as ReleaseIdentity,
      cliEngineApi: "1.2.0",
      desktopRequirements: v2Requirements,
    })
    expect(result.compatible).toBe(true)
  })
})
