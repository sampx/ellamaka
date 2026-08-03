import { describe, expect, test } from "bun:test"
import {
  parseReleaseTag,
  parseLegacyTag,
  buildReferenceGraph,
  planRetention,
  planWithdraw,
  type ReleaseSnapshot,
  type AliasMap,
} from "../scripts/cleanup-desktop-releases.mjs"

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
