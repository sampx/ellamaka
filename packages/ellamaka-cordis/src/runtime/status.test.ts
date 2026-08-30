import { describe, expect, test } from "bun:test"
import {
  closureNameForFingerprint,
  expandCacheDir,
  isDshEnabled,
  resolveDshLayout,
} from "./status"

describe("isDshEnabled (Gate)", () => {
  test("returns false when ELLAMAKA_DSH is exactly 0", () => {
    expect(isDshEnabled({ ELLAMAKA_DSH: "0" })).toBe(false)
  })

  test("returns true when the variable is unset", () => {
    expect(isDshEnabled({})).toBe(true)
  })

  test("returns true for any non-0 value", () => {
    expect(isDshEnabled({ ELLAMAKA_DSH: "1" })).toBe(true)
    expect(isDshEnabled({ ELLAMAKA_DSH: "false" })).toBe(true)
  })
})

describe("resolveDshLayout", () => {
  test("derives the single dsh home under wopalHome (never DSH_HOME)", () => {
    const layout = resolveDshLayout("/tmp/wh")
    expect(layout.dshHome).toBe("/tmp/wh/dsh")
    expect(layout.closuresDir).toBe("/tmp/wh/dsh/closures")
    expect(layout.stagingDir).toBe("/tmp/wh/dsh/staging")
    expect(layout.locksDir).toBe("/tmp/wh/dsh/locks")
    expect(layout.lockFile).toBe("/tmp/wh/dsh/locks/materialize.lock")
    expect(layout.profileDir).toBe("/tmp/wh/dsh/profiles")
    expect(layout.stateDir).toBe("/tmp/wh/dsh/state")
  })
})

describe("closureNameForFingerprint", () => {
  test("takes the first 12 hex chars of the sha256 digest", () => {
    const fp = "sha256:9e1ee84dfdd992bf9ebb37c7506f13bc17b87158d02783c2b1b24fd25a32cda7"
    expect(closureNameForFingerprint(fp)).toBe("9e1ee84dfdd9")
    expect(closureNameForFingerprint(fp)).toMatch(/^[0-9a-f]{12}$/)
  })
})

describe("expandCacheDir", () => {
  test("resolves ~ to the user home npm cacache dir", () => {
    expect(expandCacheDir()).toMatch(/[\\/]_cacache$/)
  })
})
