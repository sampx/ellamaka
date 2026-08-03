import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"

const currentDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(currentDir, "..", "..", "..")
const fixturesDir = join(currentDir, "fixtures", "release")

// Modules under test. Loaded dynamically so the RED phase fails clearly when
// the implementation files do not exist yet.
const identity = await import("../../../scripts/release-identity.mjs")
const context = await import("../../../scripts/release-context.mjs")

const COMMIT_40 = "385cb694419f98103af0e8fc6187ddcbcbb6eecb"
const ELLAMAKA_COMMIT_40 = "91a7db1f22a2007588ee2a62e5d738b7d8e80291"

function loadFixture(rel: string) {
  return JSON.parse(readFileSync(join(fixturesDir, rel), "utf8"))
}

describe("release-identity: standard SemVer subset", () => {
  test("accepts stable X.Y.Z", () => {
    expect(identity.parseReleaseVersion("1.17.1")).toEqual({
      major: 1,
      minor: 17,
      patch: 1,
      prerelease: null,
      channel: "stable",
    })
  })

  test("accepts beta X.Y.Z-beta.N", () => {
    expect(identity.parseReleaseVersion("1.17.0-beta.1")).toEqual({
      major: 1,
      minor: 17,
      patch: 0,
      prerelease: { kind: "beta", n: 1 },
      channel: "beta",
    })
  })

  test("rejects rc X.Y.Z-rc.N (rc mechanism removed)", () => {
    expect(() => identity.parseReleaseVersion("1.18.0-rc.2")).toThrow(/rc/)
  })

  test("rejects legacy X.Y.Z-N (numeric suffix)", () => {
    expect(() => identity.parseReleaseVersion("1.15.13-4")).toThrow(/legacy/)
  })

  test("rejects +build metadata", () => {
    expect(() => identity.parseReleaseVersion("1.17.1+sha.abc")).toThrow(/build/)
  })

  test("rejects legacy X.Y.Z-N.rcM", () => {
    expect(() => identity.parseReleaseVersion("1.15.13-1.rc2")).toThrow(/legacy/)
  })

  test("rejects non-SemVer garbage", () => {
    expect(() => identity.parseReleaseVersion("not-a-version")).toThrow()
  })
})

describe("release-identity: channel/version consistency", () => {
  test("stable version must not carry prerelease", () => {
    expect(() => identity.assertChannelVersionConsistent("stable", "1.17.1-beta.1")).toThrow(/channel/)
  })

  test("beta version must use -beta.N", () => {
    expect(() => identity.assertChannelVersionConsistent("beta", "1.17.0")).toThrow(/channel/)
  })

  test("rc channel is not a release channel", () => {
    expect(() => identity.assertChannelVersionConsistent("rc", "1.17.0")).toThrow()
    expect(() => identity.assertChannelVersionConsistent("rc", "1.17.0-beta.1")).toThrow()
  })

  test("desktop prod feed maps to stable channel", () => {
    expect(identity.normalizeFeedChannel("prod")).toBe("stable")
    expect(identity.normalizeFeedChannel("beta")).toBe("beta")
  })
})

describe("release-identity: namespaced tag", () => {
  test("builds namespaced CLI tag", () => {
    expect(identity.buildNamespacedTag("ellamaka-cli", "1.17.1")).toBe("ellamaka-cli-v1.17.1")
  })

  test("builds namespaced Desktop beta tag", () => {
    expect(identity.buildNamespacedTag("ellamaka-desktop", "1.17.0-beta.1")).toBe(
      "ellamaka-desktop-v1.17.0-beta.1",
    )
  })

  test("parses namespaced tag back to product + version", () => {
    expect(identity.parseNamespacedTag("ellamaka-cli-v1.17.1")).toEqual({
      product: "ellamaka-cli",
      version: "1.17.1",
    })
    expect(identity.parseNamespacedTag("ellamaka-desktop-v1.16.2")).toEqual({
      product: "ellamaka-desktop",
      version: "1.16.2",
    })
  })

  test("rejects generic vX.Y.Z tag without product namespace", () => {
    expect(() => identity.parseNamespacedTag("v1.17.1")).toThrow(/namespaced/)
  })
})

describe("release-identity: release kind (discriminated union)", () => {
  const baseReleaseInput = {
    schemaVersion: 2,
    kind: "release" as const,
    product: "ellamaka-cli",
    version: "1.17.1",
    channel: "stable",
    upstream: { name: "opencode", version: "1.15.13", gitCommit: COMMIT_40 },
    build: {
      sourceTag: "ellamaka-cli-v1.17.1",
      gitCommit: ELLAMAKA_COMMIT_40,
      builtAt: "2026-08-03T08:30:00Z",
      workflowRunId: "123456789",
    },
  }

  test("accepts a valid release identity", () => {
    const parsed = identity.parseReleaseIdentity(baseReleaseInput)
    expect(parsed.kind).toBe("release")
    expect(parsed.build.sourceTag).toBe("ellamaka-cli-v1.17.1")
  })

  test("rejects release identity missing sourceTag", () => {
    const bad = { ...baseReleaseInput, build: { ...baseReleaseInput.build, sourceTag: undefined } }
    expect(() => identity.parseReleaseIdentity(bad)).toThrow(/sourceTag/)
  })

  test("rejects release identity missing workflowRunId", () => {
    const bad = { ...baseReleaseInput, build: { ...baseReleaseInput.build, workflowRunId: undefined } }
    expect(() => identity.parseReleaseIdentity(bad)).toThrow(/workflowRunId/)
  })

  test("rejects release identity with short gitCommit", () => {
    const bad = { ...baseReleaseInput, build: { ...baseReleaseInput.build, gitCommit: "abc123" } }
    expect(() => identity.parseReleaseIdentity(bad)).toThrow(/gitCommit/)
  })

  test("rejects release identity with +build in version", () => {
    const bad = { ...baseReleaseInput, version: "1.17.1+sha" }
    expect(() => identity.parseReleaseIdentity(bad)).toThrow(/build/)
  })
})

describe("release-identity: development kind (discriminated union)", () => {
  const baseDevInput = {
    schemaVersion: 2,
    kind: "development" as const,
    product: "ellamaka-cli",
    version: "0.0.0-dev.385cb694",
    channel: "local",
    build: {
      gitCommit: ELLAMAKA_COMMIT_40,
      builtAt: "2026-08-03T08:30:00Z",
    },
  }

  test("accepts a valid development identity", () => {
    const parsed = identity.parseReleaseIdentity(baseDevInput)
    expect(parsed.kind).toBe("development")
    expect(parsed.channel).toBe("local")
  })

  test("rejects development identity that carries sourceTag (forbidden field)", () => {
    const bad = {
      ...baseDevInput,
      build: { ...baseDevInput.build, sourceTag: "ellamaka-cli-v1.17.1" },
    }
    expect(() => identity.parseReleaseIdentity(bad)).toThrow(/sourceTag/)
  })

  test("rejects development identity that carries workflowRunId (forbidden field)", () => {
    const bad = {
      ...baseDevInput,
      build: { ...baseDevInput.build, workflowRunId: "123" },
    }
    expect(() => identity.parseReleaseIdentity(bad)).toThrow(/workflowRunId/)
  })

  test("accepts development channel main", () => {
    const dev = { ...baseDevInput, channel: "main" }
    expect(identity.parseReleaseIdentity(dev).channel).toBe("main")
  })

  test("rejects development identity with stable channel", () => {
    const bad = { ...baseDevInput, channel: "stable" }
    expect(() => identity.parseReleaseIdentity(bad)).toThrow(/channel/)
  })
})

describe("release-identity: unknown kind", () => {
  test("rejects unknown kind", () => {
    const bad = {
      schemaVersion: 2,
      kind: "staging",
      product: "ellamaka-cli",
      version: "1.0.0",
      channel: "stable",
      upstream: { name: "opencode", version: "1.15.13", gitCommit: COMMIT_40 },
      build: { sourceTag: "x", gitCommit: ELLAMAKA_COMMIT_40, builtAt: "t", workflowRunId: "1" },
    }
    expect(() => identity.parseReleaseIdentity(bad)).toThrow(/kind/)
  })
})

describe("release-identity: upstream lock", () => {
  test("loads lock fixture with sources.opencode and componentBaselines", () => {
    const lock = identity.loadUpstreamLock(join(fixturesDir, "upstream-lock", "valid.lock.json"))
    expect(lock.schemaVersion).toBe(1)
    expect(lock.sources.opencode.version).toBe("1.15.13")
    expect(lock.sources.opencode.gitCommit).toBe(COMMIT_40)
    expect(lock.componentBaselines["packages/app"].version).toBe("1.15.13")
    expect(lock.componentBaselines["packages/desktop"].gitCommit).toBe(COMMIT_40)
  })

  test("validates lock: all versions stable SemVer, commits 40-char SHA", () => {
    const lock = identity.loadUpstreamLock(join(fixturesDir, "upstream-lock", "valid.lock.json"))
    expect(() => identity.validateUpstreamLock(lock)).not.toThrow()
  })

  test("rejects lock with prerelease upstream version", () => {
    const lock = loadFixture("upstream-lock/prerelease.lock.json")
    expect(() => identity.validateUpstreamLock(lock)).toThrow(/version/)
  })

  test("rejects lock with short commit", () => {
    const lock = loadFixture("upstream-lock/short-commit.lock.json")
    expect(() => identity.validateUpstreamLock(lock)).toThrow(/ECOMMIT/)
  })

  test("release builder reads sources.opencode from lock, not from input", () => {
    const lock = identity.loadUpstreamLock(join(fixturesDir, "upstream-lock", "valid.lock.json"))
    const id = identity.buildReleaseIdentity({
      product: "ellamaka-cli",
      version: "1.17.1",
      channel: "stable",
      upstreamLock: lock,
      gitCommit: ELLAMAKA_COMMIT_40,
      builtAt: "2026-08-03T08:30:00Z",
      workflowRunId: "123456789",
    })
    expect(id.upstream.version).toBe("1.15.13")
    expect(id.upstream.gitCommit).toBe(COMMIT_40)
  })
})

describe("release-context: assembly from tag + lock + commit", () => {
  test("builds release context from namespaced tag and lock", () => {
    const lock = identity.loadUpstreamLock(join(fixturesDir, "upstream-lock", "valid.lock.json"))
    const ctx = context.buildReleaseContext({
      tag: "ellamaka-cli-v1.17.1",
      upstreamLock: lock,
      gitCommit: ELLAMAKA_COMMIT_40,
      workflowRunId: "123456789",
      builtAt: "2026-08-03T08:30:00Z",
    })

    expect(ctx.product).toBe("ellamaka-cli")
    expect(ctx.version).toBe("1.17.1")
    expect(ctx.channel).toBe("stable")
    expect(ctx.upstream.version).toBe("1.15.13")
    expect(ctx.build.sourceTag).toBe("ellamaka-cli-v1.17.1")
    expect(ctx.build.gitCommit).toBe(ELLAMAKA_COMMIT_40)
    expect(ctx.build.workflowRunId).toBe("123456789")
  })

  test("builds beta release context", () => {
    const lock = identity.loadUpstreamLock(join(fixturesDir, "upstream-lock", "valid.lock.json"))
    const ctx = context.buildReleaseContext({
      tag: "ellamaka-desktop-v1.17.0-beta.1",
      upstreamLock: lock,
      gitCommit: ELLAMAKA_COMMIT_40,
      workflowRunId: "123456789",
      builtAt: "2026-08-03T08:30:00Z",
    })

    expect(ctx.product).toBe("ellamaka-desktop")
    expect(ctx.version).toBe("1.17.0-beta.1")
    expect(ctx.channel).toBe("beta")
  })

  test("release context identity equals standalone identity builder", () => {
    const lock = identity.loadUpstreamLock(join(fixturesDir, "upstream-lock", "valid.lock.json"))
    const args = {
      tag: "ellamaka-cli-v1.17.1",
      upstreamLock: lock,
      gitCommit: ELLAMAKA_COMMIT_40,
      workflowRunId: "123456789",
      builtAt: "2026-08-03T08:30:00Z",
    }
    const ctx = context.buildReleaseContext(args)
    const standalone = identity.buildReleaseIdentity({
      product: ctx.product,
      version: ctx.version,
      channel: ctx.channel,
      upstreamLock: lock,
      gitCommit: ELLAMAKA_COMMIT_40,
      builtAt: "2026-08-03T08:30:00Z",
      workflowRunId: "123456789",
    })
    expect(ctx).toMatchObject(standalone)
  })
})

describe("release-identity: legacy reader", () => {
  test("classifies legacy X.Y.Z-N as legacy-stable-iteration", () => {
    const legacy = identity.parseLegacyVersion("1.15.13-4")
    expect(legacy.kind).toBe("legacy")
    expect(legacy.legacyShape).toBe("stable-iteration")
    expect(legacy.major).toBe(1)
    expect(legacy.iteration).toBe(4)
  })

  test("classifies legacy X.Y.Z-N.rcM as legacy-rc-iteration", () => {
    const legacy = identity.parseLegacyVersion("1.15.13-1.rc2")
    expect(legacy.kind).toBe("legacy")
    expect(legacy.legacyShape).toBe("rc-iteration")
    expect(legacy.iteration).toBe(1)
    expect(legacy.rcN).toBe(2)
  })

  test("legacy reader does not produce a new release identity", () => {
    const legacy = identity.parseLegacyVersion("1.15.13-4")
    expect(legacy.convertibleToRelease).toBe(false)
  })

  test("rejects non-legacy standard version in legacy reader", () => {
    expect(() => identity.parseLegacyVersion("1.17.1")).toThrow(/not.*legacy/)
  })
})

describe("release-identity: migration floor", () => {
  test("derives floor as same-base stable above highest legacy prerelease", () => {
    const inventory = loadFixture("legacy/sample-inventory.json")
    const floor = identity.computeMigrationFloor(inventory, "ellamaka-cli")
    // Highest legacy is 1.15.13-4; per SemVer 2.0 the same-base stable
    // 1.15.13 already sorts above it → floor is 1.15.13, not 1.16.0.
    expect(floor).toBe("1.15.13")
  })

  test("migration floor for product with no legacy defaults to 1.0.0", () => {
    const inventory = loadFixture("legacy/sample-inventory.json")
    const floor = identity.computeMigrationFloor(inventory, "ellamaka-desktop")
    // Desktop has no legacy entries in fixture → default floor
    expect(floor).toBe("1.0.0")
  })
})

describe("release-identity: tag allocator fail-closed", () => {
  test("version below migration floor is rejected", () => {
    const inventory = loadFixture("legacy/sample-inventory.json")
    expect(() =>
      identity.assertVersionAboveMigrationFloor("ellamaka-cli", "1.15.12", inventory),
    ).toThrow(/migration/)
  })

  test("version at migration floor is accepted (occupancy guard is separate)", () => {
    const inventory = loadFixture("legacy/sample-inventory.json")
    expect(() =>
      identity.assertVersionAboveMigrationFloor("ellamaka-cli", "1.15.13", inventory),
    ).not.toThrow()
  })

  test("version above migration floor is accepted (v1 follow-upgrade path)", () => {
    const inventory = loadFixture("legacy/sample-inventory.json")
    expect(() =>
      identity.assertVersionAboveMigrationFloor("ellamaka-cli", "1.15.14", inventory),
    ).not.toThrow()
  })

  test("version above migration floor is accepted (minor bump)", () => {
    const inventory = loadFixture("legacy/sample-inventory.json")
    expect(() =>
      identity.assertVersionAboveMigrationFloor("ellamaka-cli", "1.16.0", inventory),
    ).not.toThrow()
  })
})

describe("release-identity: SemVer precedence", () => {
  test("stable sorts above beta with same base", () => {
    expect(identity.compareSemVer("1.17.0", "1.17.0-beta.1")).toBeGreaterThan(0)
  })

  test("beta.N sorts by N", () => {
    expect(identity.compareSemVer("1.17.0-beta.2", "1.17.0-beta.1")).toBeGreaterThan(0)
    expect(identity.compareSemVer("1.17.0-beta.1", "1.17.0-beta.2")).toBeLessThan(0)
  })

  test("equal versions compare equal", () => {
    expect(identity.compareSemVer("1.17.1", "1.17.1")).toBe(0)
  })

  test("higher patch wins", () => {
    expect(identity.compareSemVer("1.17.2", "1.17.1")).toBeGreaterThan(0)
  })
})
