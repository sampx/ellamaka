import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isDshEnabled, dshPaths, materializeDshClosure, defaultMaterializeScriptPath } from "./dsh-switch"

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
// dsh closure when onboarding was skipped. `materializeDshClosure` runs the
// Task 3 arborist materialise script as a `bun` subprocess and reports whether
// the install anchor now exists.
describe("materializeDshClosure", () => {
  test("returns true without spawning when the anchor already exists", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-mat-present-"))
    const { dshHome, anchor } = dshPaths(home)
    mkdirSync(join(dshHome, "node_modules", "@deepseek-ai", "dsh"), { recursive: true })
    writeFileSync(anchor, JSON.stringify({ name: "@deepseek-ai/dsh" }))

    // A script path that would fail if invoked proves no spawn happens.
    expect(await materializeDshClosure(home, { scriptPath: join(home, "nonexistent.ts") })).toBe(true)
  })

  test("returns false when the materialise script is unavailable", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-mat-noscript-"))
    expect(await materializeDshClosure(home, { scriptPath: join(home, "missing.ts") })).toBe(false)
  })

  test("materialises the closure on a successful script run", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-mat-success-"))
    const { dshHome, anchor } = dshPaths(home)
    // A tiny script that writes the install anchor — stands in for the real
    // arborist materialise script's anchor-creating side effect.
    const script = join(home, "materialize.ts")
    writeFileSync(
      script,
      [
        `import { mkdirSync, writeFileSync } from "node:fs"`,
        `import { join } from "node:path"`,
        `import { env } from "node:process"`,
        `const dir = join(env.WOPAL_HOME!, "dsh", "node_modules", "@deepseek-ai", "dsh")`,
        `mkdirSync(dir, { recursive: true })`,
        `writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh" }))`,
      ].join("\n"),
    )

    expect(await materializeDshClosure(home, { scriptPath: script })).toBe(true)
    expect(existsSync(anchor)).toBe(true)
  })

  test("returns false and leaves the closure absent when the script fails", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-mat-fail-"))
    const { anchor } = dshPaths(home)
    const script = join(home, "fail.ts")
    writeFileSync(script, `process.exit(1)\n`)

    expect(await materializeDshClosure(home, { scriptPath: script })).toBe(false)
    expect(existsSync(anchor)).toBe(false)
  })

  test("default script path resolves to the opencode materialise script", () => {
    const p = defaultMaterializeScriptPath()
    expect(p.endsWith(join("opencode", "script", "materialize-dsh.ts"))).toBe(true)
    expect(existsSync(p)).toBe(true)
  })
})
