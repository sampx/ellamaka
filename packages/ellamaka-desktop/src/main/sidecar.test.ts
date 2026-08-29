import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { isDshEnabled, dshPaths } from "./dsh-switch"

// ELLAMAKA_DSH kill-switch gating on the sidecar must mirror Flag.ELLAMAKA_DSH
// in @opencode-ai/core (DESIGN-dsh-poc §3.4, constraint #11): default ON,
// `ELLAMAKA_DSH=0` disables.
describe("isDshEnabled", () => {
  afterEach(() => {
    delete process.env.ELLAMAKA_DSH
  })

  test("enabled when unset (default on)", () => {
    delete process.env.ELLAMAKA_DSH
    expect(isDshEnabled()).toBe(true)
  })

  test("disabled when ELLAMAKA_DSH=0", () => {
    process.env.ELLAMAKA_DSH = "0"
    expect(isDshEnabled()).toBe(false)
  })

  test("enabled when ELLAMAKA_DSH=1", () => {
    process.env.ELLAMAKA_DSH = "1"
    expect(isDshEnabled()).toBe(true)
  })
})

describe("dshPaths", () => {
  test("anchors the closure at $WOPAL_HOME/dsh, never $DSH_HOME", () => {
    const { dshHome, anchor } = dshPaths("/tmp/wopal-home")
    expect(dshHome).toBe(join("/tmp/wopal-home", "dsh"))
    expect(anchor).toBe(join("/tmp/wopal-home", "dsh", "node_modules", "@deepseek-ai", "dsh", "package.json"))
  })
})
