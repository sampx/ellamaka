import { describe, expect, it } from "vitest";
import {
  parseTag,
  compareVersions,
  partitionTags,
  selectForDeletion,
} from "../scripts/cleanup-ellamaka-releases.mjs";

describe("cleanup-ellamaka-releases: parseTag", () => {
  it("parses bare v tags (ellamaka repo format)", () => {
    expect(parseTag("v1.15.13-3")).toEqual({
      tag: "v1.15.13-3",
      version: "1.15.13-3",
      core: "1.15.13",
      suffix: "3",
      isPrerelease: false,
    });
  });

  it("parses bare v tags without suffix", () => {
    expect(parseTag("v1.15.13")).toEqual({
      tag: "v1.15.13",
      version: "1.15.13",
      core: "1.15.13",
      suffix: "",
      isPrerelease: false,
    });
  });

  it("parses ontology-prefixed tags", () => {
    expect(parseTag("ellamaka-v1.15.13-3")).toEqual({
      tag: "ellamaka-v1.15.13-3",
      version: "1.15.13-3",
      core: "1.15.13",
      suffix: "3",
      isPrerelease: false,
    });
  });

  it("detects prerelease tags (non-numeric suffix)", () => {
    expect(parseTag("v1.15.13-rc1")).toMatchObject({ isPrerelease: true });
    expect(parseTag("ellamaka-v1.15.13-beta.2")).toMatchObject({ isPrerelease: true });
  });

  it("treats numeric suffix as stable (patch iteration, not prerelease)", () => {
    expect(parseTag("v1.15.13-3")).toMatchObject({ isPrerelease: false });
    expect(parseTag("v1.15.13-1")).toMatchObject({ isPrerelease: false });
  });

  it("rejects unrelated tags", () => {
    expect(parseTag("cli-v0.3.10")).toBeNull();
    expect(parseTag("ellamaka-desktop-v1.15.13-2")).toBeNull();
    expect(parseTag("latest")).toBeNull();
  });
});

describe("cleanup-ellamaka-releases: compareVersions (descending)", () => {
  const v = (core, suffix = "", isPre = false) => ({
    version: suffix ? `${core}-${suffix}` : core,
    core,
    suffix,
    isPrerelease: isPre,
  });

  // Array.sort: negative → a sorts before b (a is higher/newer)

  it("orders by core version descending", () => {
    expect(compareVersions(v("2.0.0"), v("1.15.13"))).toBeLessThan(0);
    expect(compareVersions(v("1.14.39"), v("1.15.13"))).toBeGreaterThan(0);
  });

  it("orders numeric suffix descending (patch iteration)", () => {
    expect(compareVersions(v("1.15.13", "3"), v("1.15.13", "1"))).toBeLessThan(0);
    expect(compareVersions(v("1.15.13", "1"), v("1.15.13", "3"))).toBeGreaterThan(0);
  });

  it("orders stable (no suffix) before prerelease of same core", () => {
    expect(compareVersions(v("1.15.13"), v("1.15.13", "rc1", true))).toBeLessThan(0);
  });

  it("orders stable (no suffix) and numeric suffix: stable base is higher", () => {
    // 1.15.13 vs 1.15.13-3: 1.15.13-3 is a patch iteration, treat as higher
    expect(compareVersions(v("1.15.13", "3"), v("1.15.13"))).toBeLessThan(0);
  });
});

describe("cleanup-ellamaka-releases: partitionTags", () => {
  it("splits stable and prerelease tags", () => {
    const tags = [
      "v1.15.13-3",
      "v1.15.13-rc1",
      "ellamaka-v1.15.13",
      "cli-v0.3.10",
      "v1.14.39-beta.1",
    ];
    const { stable, prerelease } = partitionTags(tags);
    expect(stable.map((s) => s.tag)).toContain("v1.15.13-3");
    expect(stable.map((s) => s.tag)).toContain("ellamaka-v1.15.13");
    expect(prerelease.map((p) => p.tag)).toContain("v1.15.13-rc1");
    expect(prerelease.map((p) => p.tag)).toContain("v1.14.39-beta.1");
  });
});

describe("cleanup-ellamaka-releases: selectForDeletion", () => {
  const allTags = [
    "v1.15.13-3",
    "v1.15.13-1",
    "v1.15.13",
    "v1.14.39",
    "v1.14.38",
    "v1.14.37",
    "v1.14.36",
    "v1.15.13-rc1",
  ];

  it("keeps 5 stable + 1 prerelease, deletes the rest", () => {
    const toDelete = selectForDeletion(allTags, 5, 1);
    // 7 stable exist, keep 5 → delete 2 oldest stable
    // 1 prerelease exists, keep 1 → keep it
    expect(toDelete.length).toBe(2);
    expect(toDelete).toContain("v1.14.36");
    expect(toDelete).toContain("v1.14.37");
    expect(toDelete).not.toContain("v1.15.13-3");
    expect(toDelete).not.toContain("v1.15.13-rc1");
  });

  it("keeps all when fewer than keep-count exist", () => {
    const fewTags = ["v1.15.13-3", "v1.15.13-rc1"];
    expect(selectForDeletion(fewTags, 5, 1)).toEqual([]);
  });

  it("deletes excess prereleases", () => {
    const tags = [
      "v1.15.13-rc1",
      "v1.15.13-rc2",
      "v1.15.13-rc3",
    ];
    const toDelete = selectForDeletion(tags, 0, 1);
    expect(toDelete).toContain("v1.15.13-rc1");
    expect(toDelete).toContain("v1.15.13-rc2");
    expect(toDelete).not.toContain("v1.15.13-rc3");
  });
});