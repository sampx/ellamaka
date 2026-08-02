import { describe, expect, it } from "vitest";
import {
  parseTag,
  compareVersions,
  partitionTags,
  selectForDeletion,
} from "../scripts/cleanup-desktop-releases.mjs";

describe("cleanup-desktop-releases: parseTag", () => {
  it("parses prod tags", () => {
    expect(parseTag("ellamaka-desktop-v1.15.13-2")).toEqual({
      tag: "ellamaka-desktop-v1.15.13-2",
      version: "1.15.13-2",
      channel: "prod",
    });
  });

  it("parses beta tags", () => {
    expect(parseTag("ellamaka-desktop-v1.15.13-beta.3")).toEqual({
      tag: "ellamaka-desktop-v1.15.13-beta.3",
      version: "1.15.13-beta.3",
      channel: "beta",
    });
  });

  it("rejects non-desktop tags", () => {
    expect(parseTag("cli-v0.3.10")).toBeNull();
    expect(parseTag("ellamaka-v1.15.13")).toBeNull();
    expect(parseTag("v1.15.13-2")).toBeNull();
  });
});

describe("cleanup-desktop-releases: compareVersions (descending)", () => {
  const v = (ver, channel) => ({ version: ver, channel });

  // Array.sort: negative → a sorts before b (a is higher/newer)

  it("orders prod by suffix number descending", () => {
    expect(compareVersions(v("1.15.13-2", "prod"), v("1.15.13-1", "prod"))).toBeLessThan(0);
    expect(compareVersions(v("1.15.13-1", "prod"), v("1.15.13-2", "prod"))).toBeGreaterThan(0);
  });

  it("orders beta by suffix number descending", () => {
    expect(compareVersions(v("1.15.13-beta.3", "beta"), v("1.15.13-beta.2", "beta"))).toBeLessThan(0);
    expect(compareVersions(v("1.15.13-beta.1", "beta"), v("1.15.13-beta.3", "beta"))).toBeGreaterThan(0);
  });

  it("orders prod before beta of same core (prod is higher)", () => {
    expect(compareVersions(v("1.15.13-2", "prod"), v("1.15.13-beta.3", "beta"))).toBeLessThan(0);
  });

  it("orders by core version descending", () => {
    expect(compareVersions(v("2.0.0-1", "prod"), v("1.15.13-2", "prod"))).toBeLessThan(0);
  });
});

describe("cleanup-desktop-releases: partitionTags", () => {
  it("splits prod and beta tags", () => {
    const tags = [
      "ellamaka-desktop-v1.15.13-2",
      "ellamaka-desktop-v1.15.13-beta.3",
      "ellamaka-desktop-v1.15.13-beta.2",
      "cli-v0.3.10",
      "ellamaka-v1.15.13",
    ];
    const { prod, beta } = partitionTags(tags);
    expect(prod.map((p) => p.tag)).toEqual(["ellamaka-desktop-v1.15.13-2"]);
    expect(beta.map((b) => b.tag)).toEqual([
      "ellamaka-desktop-v1.15.13-beta.3",
      "ellamaka-desktop-v1.15.13-beta.2",
    ]);
  });
});

describe("cleanup-desktop-releases: selectForDeletion", () => {
  const allTags = [
    "ellamaka-desktop-v1.15.13-2",
    "ellamaka-desktop-v1.15.13-1",
    "ellamaka-desktop-v1.15.13-beta.3",
    "ellamaka-desktop-v1.15.13-beta.2",
    "ellamaka-desktop-v1.15.13-beta.1",
  ];

  it("keeps 3 prod + 2 beta, deletes the rest", () => {
    const toDelete = selectForDeletion(allTags, 3, 2);
    // Only 2 prod exist (under 3), so none deleted from prod
    // 3 beta exist, keep 2, delete 1 (beta.1)
    expect(toDelete).toContain("ellamaka-desktop-v1.15.13-beta.1");
    expect(toDelete).not.toContain("ellamaka-desktop-v1.15.13-2");
    expect(toDelete).not.toContain("ellamaka-desktop-v1.15.13-beta.3");
    expect(toDelete).not.toContain("ellamaka-desktop-v1.15.13-beta.2");
  });

  it("keeps all when fewer than keep-count exist", () => {
    const fewTags = ["ellamaka-desktop-v1.15.13-2", "ellamaka-desktop-v1.15.13-beta.1"];
    expect(selectForDeletion(fewTags, 3, 2)).toEqual([]);
  });

  it("deletes excess prod", () => {
    const tags = [
      "ellamaka-desktop-v1.15.13-4",
      "ellamaka-desktop-v1.15.13-3",
      "ellamaka-desktop-v1.15.13-2",
      "ellamaka-desktop-v1.15.13-1",
    ];
    const toDelete = selectForDeletion(tags, 2, 0);
    expect(toDelete).toContain("ellamaka-desktop-v1.15.13-2");
    expect(toDelete).toContain("ellamaka-desktop-v1.15.13-1");
    expect(toDelete).not.toContain("ellamaka-desktop-v1.15.13-4");
    expect(toDelete).not.toContain("ellamaka-desktop-v1.15.13-3");
  });

  it("handles ellamaka repo tag format (desktop-v tags in wopal-cn/ellamaka)", () => {
    // wopal-cn/ellamaka holds the same ellamaka-desktop-v tag shape as the
    // ontology repo; cleanup must classify and prune them identically.
    const ellamakaTags = [
      "ellamaka-desktop-v1.15.13-2",
      "ellamaka-desktop-v1.15.13-1",
      "ellamaka-desktop-v1.15.13-beta.4",
      "ellamaka-desktop-v1.15.13-beta.3",
      "ellamaka-desktop-v1.15.13-beta.2",
    ];
    const toDelete = selectForDeletion(ellamakaTags, 3, 2);
    // 2 prod (under 3 keep) → none deleted from prod
    // 3 beta, keep 2 → delete the oldest beta (beta.2)
    expect(toDelete).toEqual(["ellamaka-desktop-v1.15.13-beta.2"]);
    expect(toDelete).not.toContain("ellamaka-desktop-v1.15.13-2");
    expect(toDelete).not.toContain("ellamaka-desktop-v1.15.13-beta.4");
    expect(toDelete).not.toContain("ellamaka-desktop-v1.15.13-beta.3");
  });
});
