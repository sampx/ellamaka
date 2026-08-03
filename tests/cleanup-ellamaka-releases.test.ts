import { describe, expect, test } from "bun:test"
import {
  parseReleaseTag,
  parseLegacyTag,
  buildReferenceGraph,
  planRetention,
  planWithdraw,
  type ReleaseSnapshot,
  type AliasMap,
} from "../scripts/cleanup-ellamaka-releases.mjs"

// ---------------------------------------------------------------------------
// Task 5: cleanup protection model.
//
// Per docs/RELEASE-IDENTITY.md §9.1, cleanup must NOT use sort -V, mtime, or
// the legacy X.Y.Z-N numeric-suffix comparator to decide "newer" versions.
// It builds a reference graph (latest + updater aliases are protected), and
// only standard SemVer releases within the same product/channel become
// retention candidates. Legacy/unknown objects fail closed.
// ---------------------------------------------------------------------------

describe("cleanup-ellamaka: parseReleaseTag (standard SemVer)", () => {
  test("parses namespaced CLI stable tag", () => {
    expect(parseReleaseTag("ellamaka-cli-v1.17.1")).toEqual({
      product: "ellamaka-cli",
      version: "1.17.1",
      channel: "stable",
      kind: "standard",
    })
  })

  test("parses namespaced CLI beta tag", () => {
    expect(parseReleaseTag("ellamaka-cli-v1.17.0-beta.1")).toEqual({
      product: "ellamaka-cli",
      version: "1.17.0-beta.1",
      channel: "beta",
      kind: "standard",
    })
  })

  test("returns null for generic vX.Y.Z tag (not namespaced)", () => {
    expect(parseReleaseTag("v1.17.1")).toBeNull()
  })

  test("returns null for desktop tag in CLI cleanup", () => {
    expect(parseReleaseTag("ellamaka-desktop-v1.16.2")).toBeNull()
  })
})

describe("cleanup-ellamaka: parseLegacyTag (read-only legacy)", () => {
  test("classifies legacy X.Y.Z-N", () => {
    expect(parseLegacyTag("v1.15.13-4")).toEqual({
      product: "ellamaka-cli",
      version: "1.15.13-4",
      kind: "legacy",
      legacyShape: "stable-iteration",
    })
  })

  test("classifies ontology-prefixed legacy tag", () => {
    expect(parseLegacyTag("ellamaka-v1.15.13-4")).toEqual({
      product: "ellamaka-cli",
      version: "1.15.13-4",
      kind: "legacy",
      legacyShape: "stable-iteration",
    })
  })

  test("returns null for standard SemVer tag", () => {
    expect(parseLegacyTag("ellamaka-cli-v1.17.1")).toBeNull()
  })
})

describe("cleanup-ellamaka: reference graph protection", () => {
  const snapshot: ReleaseSnapshot = {
    versionedPaths: ["ellamaka/v1.17.1", "ellamaka/v1.16.0", "ellamaka/v1.15.13-4"],
    tags: ["ellamaka-cli-v1.17.1", "ellamaka-cli-v1.16.0", "v1.15.13-4"],
  }
  const aliases: AliasMap = {
    "ellamaka/latest/manifest.json": "1.17.1",
  }

  test("marks latest-referenced release as protected", () => {
    const graph = buildReferenceGraph(snapshot, aliases)
    expect(graph.protected.has("ellamaka/v1.17.1")).toBe(true)
    expect(graph.protectedReason.get("ellamaka/v1.17.1")).toMatch(/latest/)
  })

  test("does not protect unreferenced versioned paths", () => {
    const graph = buildReferenceGraph(snapshot, aliases)
    expect(graph.protected.has("ellamaka/v1.16.0")).toBe(false)
  })

  test("legacy paths are classified but not protected", () => {
    const graph = buildReferenceGraph(snapshot, aliases)
    expect(graph.legacy.has("ellamaka/v1.15.13-4")).toBe(true)
    expect(graph.protected.has("ellamaka/v1.15.13-4")).toBe(false)
  })
})

describe("cleanup-ellamaka: retention plan", () => {
  const snapshot: ReleaseSnapshot = {
    versionedPaths: [
      "ellamaka/v1.17.1",
      "ellamaka/v1.17.0",
      "ellamaka/v1.16.0",
      "ellamaka/v1.15.0",
      "ellamaka/v1.14.0",
      "ellamaka/v1.15.13-4", // legacy
    ],
    tags: [],
  }
  const aliases: AliasMap = {
    "ellamaka/latest/manifest.json": "1.17.1",
  }

  test("keeps N newest standard stable releases, deletes older ones", () => {
    const plan = planRetention({
      product: "ellamaka-cli",
      channel: "stable",
      snapshot,
      aliases,
      keepStable: 3,
    })
    // Sorted descending: 1.17.1, 1.17.0, 1.16.0, 1.15.0, 1.14.0
    // 1.17.1 is protected (latest). keep 3 → 1.17.1, 1.17.0, 1.16.0 kept
    // Delete: 1.15.0, 1.14.0
    expect(plan.deleteCandidates.map((c) => c.version)).toEqual(["1.15.0", "1.14.0"])
    expect(plan.deleteCandidates.every((c) => !c.protected)).toBe(true)
  })

  test("never deletes protected (latest-referenced) releases", () => {
    const plan = planRetention({
      product: "ellamaka-cli",
      channel: "stable",
      snapshot,
      aliases,
      keepStable: 1,
    })
    // Even with keepStable=1, the protected 1.17.1 must not be deleted.
    expect(plan.deleteCandidates.find((c) => c.version === "1.17.1")).toBeUndefined()
  })

  test("legacy releases are NOT deletion candidates (fail-closed)", () => {
    const plan = planRetention({
      product: "ellamaka-cli",
      channel: "stable",
      snapshot,
      aliases,
      keepStable: 3,
    })
    expect(plan.deleteCandidates.find((c) => c.version === "1.15.13-4")).toBeUndefined()
    expect(plan.legacyRetained).toContain("1.15.13-4")
  })

  test("dry-run produces no mutation but lists candidates", () => {
    const plan = planRetention({
      product: "ellamaka-cli",
      channel: "stable",
      snapshot,
      aliases,
      keepStable: 3,
      dryRun: true,
    })
    expect(plan.deleteCandidates.length).toBeGreaterThan(0)
    expect(plan.dryRun).toBe(true)
  })
})

describe("cleanup-ellamaka: withdraw plan", () => {
  const snapshot: ReleaseSnapshot = {
    versionedPaths: ["ellamaka/v1.16.0", "ellamaka/v1.17.0"],
    tags: ["ellamaka-cli-v1.16.0", "ellamaka-cli-v1.17.0"],
  }
  const aliases: AliasMap = {
    "ellamaka/latest/manifest.json": "1.16.0", // broken version to withdraw
  }
  const withdrawn = { schemaVersion: 1, products: { "ellamaka-cli": ["1.16.0"] } }

  test("rejects withdraw of version not in withdrawn-versions.json", () => {
    const plan = planWithdraw({
      product: "ellamaka-cli",
      version: "1.17.0",
      snapshot,
      aliases,
      withdrawn,
      fallbackVersion: "1.17.0",
    })
    expect(plan.allowed).toBe(false)
    expect(plan.reason).toMatch(/withdrawn/)
  })

  test("rejects withdraw when fallback is not a valid healthy alias", () => {
    const plan = planWithdraw({
      product: "ellamaka-cli",
      version: "1.16.0",
      snapshot,
      aliases,
      withdrawn,
      fallbackVersion: "0.0.0", // not in versioned paths
    })
    expect(plan.allowed).toBe(false)
    expect(plan.reason).toMatch(/fallback/)
  })

  test("allows withdraw with valid fallback and withdrawn record", () => {
    const plan = planWithdraw({
      product: "ellamaka-cli",
      version: "1.16.0",
      snapshot,
      aliases,
      withdrawn,
      fallbackVersion: "1.17.0",
    })
    expect(plan.allowed).toBe(true)
    expect(plan.steps.map((s) => s.action)).toContain("restore-alias")
    expect(plan.steps.map((s) => s.action)).toContain("delete-versioned-path")
    expect(plan.steps.map((s) => s.action)).toContain("delete-tag")
  })

  test("withdraw steps order: restore aliases BEFORE delete", () => {
    const plan = planWithdraw({
      product: "ellamaka-cli",
      version: "1.16.0",
      snapshot,
      aliases,
      withdrawn,
      fallbackVersion: "1.17.0",
    })
    const restoreIdx = plan.steps.findIndex((s) => s.action === "restore-alias")
    const deleteIdx = plan.steps.findIndex((s) => s.action === "delete-versioned-path")
    expect(restoreIdx).toBeLessThan(deleteIdx)
  })
})
