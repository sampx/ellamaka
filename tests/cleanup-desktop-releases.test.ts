import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  parseReleaseTag,
  parseLegacyTag,
  buildReferenceGraph,
  planRetention,
  planWithdraw,
  applyRetentionWithRecheck,
  type ReleaseSnapshot,
  type AliasMap,
} from "../scripts/cleanup-desktop-releases.mjs"

const currentDir = dirname(fileURLToPath(import.meta.url))
const scriptSource = readFileSync(join(currentDir, "..", "scripts", "cleanup-desktop-releases.mjs"), "utf8")

describe("cleanup-desktop: parseReleaseTag (standard SemVer)", () => {
  test("parses namespaced Desktop stable tag", () => {
    expect(parseReleaseTag("ellamaka-desktop-v1.16.2")).toEqual({
      product: "ellamaka-desktop",
      version: "1.16.2",
      channel: "stable",
      kind: "standard",
    })
  })

  test("parses namespaced Desktop beta tag", () => {
    expect(parseReleaseTag("ellamaka-desktop-v1.17.0-beta.1")).toEqual({
      product: "ellamaka-desktop",
      version: "1.17.0-beta.1",
      channel: "beta",
      kind: "standard",
    })
  })

  test("returns null for CLI tag in desktop cleanup", () => {
    expect(parseReleaseTag("ellamaka-cli-v1.17.1")).toBeNull()
  })

  test("returns null for generic vX.Y.Z tag", () => {
    expect(parseReleaseTag("v1.16.2")).toBeNull()
  })
})

describe("cleanup-desktop: parseLegacyTag (read-only legacy)", () => {
  test("classifies legacy desktop prod tag", () => {
    expect(parseLegacyTag("ellamaka-desktop-v1.15.13-2")).toEqual({
      product: "ellamaka-desktop",
      version: "1.15.13-2",
      kind: "legacy",
      legacyShape: "stable-iteration",
    })
  })

  test("classifies legacy desktop beta tag", () => {
    expect(parseLegacyTag("ellamaka-desktop-v1.15.13-beta.3")).toEqual({
      product: "ellamaka-desktop",
      version: "1.15.13-beta.3",
      kind: "legacy",
      legacyShape: "beta-iteration",
    })
  })

  test("returns null for standard SemVer tag", () => {
    expect(parseLegacyTag("ellamaka-desktop-v1.16.2")).toBeNull()
  })
})

describe("cleanup-desktop: reference graph protection", () => {
  const snapshot: ReleaseSnapshot = {
    versionedPaths: [
      "ellamaka-desktop/v1.16.2",
      "ellamaka-desktop/v1.16.0",
      "ellamaka-desktop/beta/v1.17.0-beta.1",
    ],
    tags: ["ellamaka-desktop-v1.16.2", "ellamaka-desktop-v1.16.0", "ellamaka-desktop-v1.17.0-beta.1"],
  }
  const aliases: AliasMap = {
    "ellamaka-desktop/latest/manifest.json": "1.16.2",
    "ellamaka-desktop/beta/latest/manifest.json": "1.17.0-beta.1",
  }

  test("protects stable latest-referenced release", () => {
    const graph = buildReferenceGraph(snapshot, aliases)
    expect(graph.protected.has("ellamaka-desktop/v1.16.2")).toBe(true)
  })

  test("protects beta latest-referenced release", () => {
    const graph = buildReferenceGraph(snapshot, aliases)
    expect(graph.protected.has("ellamaka-desktop/beta/v1.17.0-beta.1")).toBe(true)
  })

  test("does not protect unreferenced stable release", () => {
    const graph = buildReferenceGraph(snapshot, aliases)
    expect(graph.protected.has("ellamaka-desktop/v1.16.0")).toBe(false)
  })
})

describe("cleanup-desktop: retention plan per channel", () => {
  const snapshot: ReleaseSnapshot = {
    versionedPaths: [
      "ellamaka-desktop/v1.16.2",
      "ellamaka-desktop/v1.16.1",
      "ellamaka-desktop/v1.16.0",
      "ellamaka-desktop/v1.15.0",
    ],
    tags: [],
  }
  const aliases: AliasMap = {
    "ellamaka-desktop/latest/manifest.json": "1.16.2",
  }

  test("keeps N newest stable, deletes older", () => {
    const plan = planRetention({
      product: "ellamaka-desktop",
      channel: "stable",
      snapshot,
      aliases,
      keepStable: 2,
    })
    // 1.16.2 protected + 1.16.1 kept → delete 1.16.0, 1.15.0
    expect(plan.deleteCandidates.map((c) => c.version).sort()).toEqual(["1.15.0", "1.16.0"])
  })

  test("never deletes protected stable latest", () => {
    const plan = planRetention({
      product: "ellamaka-desktop",
      channel: "stable",
      snapshot,
      aliases,
      keepStable: 1,
    })
    expect(plan.deleteCandidates.find((c) => c.version === "1.16.2")).toBeUndefined()
  })
})

describe("cleanup-desktop: withdraw plan", () => {
  const snapshot: ReleaseSnapshot = {
    versionedPaths: ["ellamaka-desktop/v1.16.0", "ellamaka-desktop/v1.17.0"],
    tags: ["ellamaka-desktop-v1.16.0", "ellamaka-desktop-v1.17.0"],
  }
  const aliases: AliasMap = {
    "ellamaka-desktop/latest/manifest.json": "1.16.0",
  }
  const withdrawn = { schemaVersion: 1, products: { "ellamaka-desktop": ["1.16.0"] } }

  test("allows withdraw with valid fallback", () => {
    const plan = planWithdraw({
      product: "ellamaka-desktop",
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

  test("rejects withdraw without withdrawn record", () => {
    const plan = planWithdraw({
      product: "ellamaka-desktop",
      version: "1.17.0",
      snapshot,
      aliases,
      withdrawn,
      fallbackVersion: "1.17.0",
    })
    expect(plan.allowed).toBe(false)
  })
})

describe("cleanup-desktop: W-06 apply-time recheck", () => {
  test("skips candidates that became protected since plan", () => {
    const snapshot: ReleaseSnapshot = {
      versionedPaths: [
        "ellamaka-desktop/v1.16.2",
        "ellamaka-desktop/v1.15.0",
      ],
      tags: [],
    }
    const planAliases: AliasMap = {
      "ellamaka-desktop/latest/manifest.json": "1.16.2",
    }
    const plan = planRetention({
      product: "ellamaka-desktop",
      channel: "stable",
      snapshot,
      aliases: planAliases,
      keepStable: 1,
    })
    expect(plan.deleteCandidates.map((c) => c.version)).toEqual(["1.15.0"])

    // Concurrent move: latest now points to 1.15.0 → must skip.
    const freshAliases: AliasMap = {
      "ellamaka-desktop/latest/manifest.json": "1.15.0",
    }
    const freshGraph = buildReferenceGraph(snapshot, freshAliases)
    const { kept, skipped } = applyRetentionWithRecheck(plan, freshGraph)
    expect(kept).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(skipped[0].version).toBe("1.15.0")
  })
})

describe("cleanup-desktop: contract — main path uses protection model", () => {
  test("script does not export selectForDeletion / compareVersions / parseTag", () => {
    expect(scriptSource).not.toContain("export function selectForDeletion")
    expect(scriptSource).not.toContain("export function compareVersions")
    expect(scriptSource).not.toContain("export function parseTag")
  })

  test("script does not use sort -V or numeric-suffix comparator in main path", () => {
    expect(scriptSource).not.toMatch(/\bsort\s+-V\b/)
  })

  test("script main calls planRetention (retention) and planWithdraw (withdraw)", () => {
    expect(scriptSource).toContain("planRetention(")
    expect(scriptSource).toContain("planWithdraw(")
  })

  test("script supports --withdraw and --fallback CLI flags", () => {
    expect(scriptSource).toContain('"--withdraw"')
    expect(scriptSource).toContain('"--fallback"')
  })
})
