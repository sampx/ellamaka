// Unit tests for the serve-side dsh engine assembly (`src/cli/cmd/dsh-mount.ts`).
//
// The packaged-CLI condition (dsh closure under $WOPAL_HOME/dsh, absent from
// the module graph) cannot be reproduced by spawning the source CLI — from
// source, require.resolve always finds the workspace node_modules. The
// resolution logic is therefore extracted into pure functions and tested
// directly; the subprocess tier keeps only the dev-path smoke check.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveDshAnchor } from "../../../src/cli/cmd/dsh-mount"

describe("resolveDshAnchor", () => {
  test("prefers the materialised closure under the dsh home when present", () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-home-"))
    const anchorDir = join(home, "node_modules", "@deepseek-ai", "dsh")
    mkdirSync(anchorDir, { recursive: true })
    writeFileSync(join(anchorDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh" }))

    expect(resolveDshAnchor(home)).toBe(join(anchorDir, "package.json"))
  })

  test("returns undefined when the dsh home has no materialised closure", () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-home-empty-"))
    expect(resolveDshAnchor(home)).toBeUndefined()
  })
})

// The regression this locks in: DSH assembly used to live inline in the
// serve handler, so the `web` entry silently shipped without any /dsh mount
// (packaged `web` fell into the SPA fallback). Every command that owns a
// server must gate on the flag and delegate to the shared assembly — the
// binary-level behaviour is verified by the build smoke, which this source
// contract complements.
describe("server entry points wire the shared dsh assembly", () => {
  const cases = [
    { cmd: "serve", path: "../../../src/cli/cmd/serve.ts" },
    { cmd: "web", path: "../../../src/cli/cmd/web.ts" },
  ]
  for (const { cmd, path } of cases) {
    test(`${cmd} gates on Flag.ELLAMAKA_DSH and calls mountDshEngine`, () => {
      const source = readFileSync(join(import.meta.dir, path), "utf-8")
      expect(source).toContain("Flag.ELLAMAKA_DSH")
      expect(source).toContain("mountDshEngine")
    })
  }

  test("web opens the browser before suspending on the dsh mount", () => {
    // Regression: the dsh mount block suspended on Effect.never BEFORE the
    // open(browser) call, so ELLAMAKA_DSH=1 web never opened a browser.
    // The browser open must precede the command's never-suspend.
    const source = readFileSync(join(import.meta.dir, "../../../src/cli/cmd/web.ts"), "utf-8")
    const openIdx = source.indexOf("open(")
    const neverIdx = source.indexOf("Effect.never")
    expect(openIdx).toBeGreaterThan(-1)
    expect(neverIdx).toBeGreaterThan(-1)
    expect(openIdx).toBeLessThan(neverIdx)
  })
})

