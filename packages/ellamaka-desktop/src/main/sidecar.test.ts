import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isDshEnabled, dshPaths, materializeDshClosure } from "./dsh-switch"
import { resolveCordisDir } from "./dsh-materializer"

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

// Runtime fallback (DESIGN-dsh-poc §3.4): the sidecar self-materialises the
// dsh closure when onboarding was skipped. The materialiser runs in-process
// with arborist (B-01) — no source-tree path, no system bun — so the packaged
// desktop can fall back to dsh even with an empty $WOPAL_HOME.
describe("materializeDshClosure", () => {
  test("returns true without installing when the anchor already exists (idempotent)", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-mat-present-"))
    const { dshHome, anchor } = dshPaths(home)
    mkdirSync(join(dshHome, "node_modules", "@deepseek-ai", "dsh"), { recursive: true })
    writeFileSync(anchor, JSON.stringify({ name: "@deepseek-ai/dsh" }))

    expect(await materializeDshClosure(home)).toBe(true)
  })

  test("degrades to false when the arborist install fails", async () => {
    // Inject a failing install to prove the materialiser degrades to false
    // (caller skips dsh and warns) instead of throwing.
    const home = mkdtempSync(join(tmpdir(), "dsh-mat-degrade-"))
    const { anchor } = dshPaths(home)
    const res = await materializeDshClosure(home, {
      install: async () => {
        throw new Error("simulated install failure")
      },
    })
    expect(res).toBe(false)
    expect(existsSync(anchor)).toBe(false)
  })

  test("materialises the closure on a successful install (anchor appears)", async () => {
    // Inject a fake install that creates the anchor, standing in for the real
    // arborist install's anchor-creating side effect.
    const home = mkdtempSync(join(tmpdir(), "dsh-mat-success-"))
    const { dshHome, anchor } = dshPaths(home)
    const res = await materializeDshClosure(home, {
      install: async () => {
        mkdirSync(join(dshHome, "node_modules", "@deepseek-ai", "dsh"), { recursive: true })
        writeFileSync(anchor, JSON.stringify({ name: "@deepseek-ai/dsh" }))
      },
    })
    expect(res).toBe(true)
    expect(existsSync(anchor)).toBe(true)
  })

  test("bundled cordis resource is available for the packaged fallback", () => {
    // The prebuild copies @wopal/ellamaka-cordis into resources/dsh-materialize/
    // cordis (shipped via electron-builder files). resolveCordisDir must locate
    // a directory with the package.json + src the closure manifest references.
    const dir = resolveCordisDir()
    expect(existsSync(join(dir, "package.json"))).toBe(true)
    expect(existsSync(join(dir, "src"))).toBe(true)
  })
})
