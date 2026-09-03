import { describe, expect, test } from "bun:test"
import {
  parseVersion,
  compareBase,
  inferNextVersion,
} from "../src/version-line"

describe("parseVersion", () => {
  test("parses base versions", () => {
    expect(parseVersion("2.0.4")).toEqual({ base: [2, 0, 4], kind: null, n: 0 })
  })
  test("parses prerelease versions", () => {
    expect(parseVersion("2.0.4-rc.1")).toEqual({ base: [2, 0, 4], kind: "rc", n: 1 })
    expect(parseVersion("2.0.4-beta.3")).toEqual({ base: [2, 0, 4], kind: "beta", n: 3 })
  })
  test("throws on non-semantic versions", () => {
    expect(() => parseVersion("abc")).toThrow()
    expect(() => parseVersion("2.0")).toThrow()
  })
})

describe("compareBase", () => {
  test("compares numerically per component", () => {
    expect(compareBase([2, 0, 4], [2, 0, 3])).toBe(1)
    expect(compareBase([2, 0, 4], [2, 0, 4])).toBe(0)
    expect(compareBase([2, 0, 10], [2, 0, 9])).toBe(1)
    expect(compareBase([2, 1, 0], [2, 0, 4])).toBe(1)
  })
})

describe("inferNextVersion — unified version-line model", () => {
  // Version line (root package.json) is the single source of truth for the
  // base; product anchors (cli/desktop package.json) carry the channel state.
  test("stable release takes the version-line base itself", () => {
    // cli anchor 2.0.4-rc.1, line 2.0.4, no desktop prerelease → 2.0.4
    expect(inferNextVersion({ line: "2.0.4", anchor: "2.0.4-rc.1" }, "stable")).toBe("2.0.4")
  })

  test("rc continues N+1 on the anchor base when it equals the line", () => {
    expect(inferNextVersion({ line: "2.0.4", anchor: "2.0.4-rc.1" }, "rc")).toBe("2.0.4-rc.2")
  })

  test("rc starts fresh on the line when anchor is behind", () => {
    // desktop anchor 2.0.3, line already 2.0.4 → next patch of the line
    expect(inferNextVersion({ line: "2.0.5", anchor: "2.0.3" }, "rc")).toBe("2.0.5-rc.1")
  })

  test("beta starts fresh on the line when desktop anchor is behind", () => {
    // the live case: line 2.0.4, desktop anchor 2.0.3 → 2.0.4-beta.1
    expect(inferNextVersion({ line: "2.0.4", anchor: "2.0.3" }, "beta")).toBe("2.0.4-beta.1")
  })

  test("beta continues N+1 when anchor is already on the line base", () => {
    expect(inferNextVersion({ line: "2.0.4", anchor: "2.0.4-beta.1" }, "beta")).toBe("2.0.4-beta.2")
  })

  test("rc/beta promote to the line base when anchor is behind (desktop catch-up)", () => {
    // desktop anchor 2.0.3 stable, line 2.0.4 → prod release infers 2.0.4
    expect(inferNextVersion({ line: "2.0.4", anchor: "2.0.3" }, "stable")).toBe("2.0.4")
  })

  test("minor/major bumps the line base and resets the channel", () => {
    expect(inferNextVersion({ line: "2.0.4", anchor: "2.0.4-rc.1" }, "minor")).toBe("2.1.0")
    expect(inferNextVersion({ line: "2.0.4", anchor: "2.0.3" }, "major")).toBe("3.0.0")
  })

  test("anchor ahead of line is rejected (drift guard)", () => {
    // anchor 2.0.5 ahead of line 2.0.4 means someone bumped out of band
    expect(() => inferNextVersion({ line: "2.0.4", anchor: "2.0.5" }, "stable")).toThrow(/版本线/)
    expect(() => inferNextVersion({ line: "2.0.4", anchor: "2.0.5-rc.1" }, "rc")).toThrow(/版本线/)
  })

  test("explicit version must sit on the version line", () => {
    expect(() => inferNextVersion({ line: "2.0.4", anchor: "2.0.3" }, "rc", "2.1.0-rc.1")).toThrow(/版本线/)
    expect(inferNextVersion({ line: "2.0.4", anchor: "2.0.3" }, "stable", "2.0.4")).toBe("2.0.4")
  })
})
