// Unit tests for the serve-side dsh engine assembly (`src/cli/cmd/dsh-mount.ts`).
//
// The packaged-CLI condition (dsh closure under $WOPAL_HOME/dsh, absent from
// the module graph) cannot be reproduced by spawning the source CLI — from
// source, require.resolve always finds the workspace node_modules. The
// manager-driven anchor resolution lives in @wopal/ellamaka-cordis/runtime
// (`resolveInstallAnchor`, tested in that package); this file keeps the
// source-level contract that every command owning a server wires the shared
// assembly through the unified Runtime Manager.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The regression this locks in: DSH assembly used to live inline in the
// serve handler, so the `web` entry silently shipped without any /dsh mount
// (packaged `web` fell into the SPA fallback). Every command that owns a
// server must delegate to the shared assembly — which now runs the unified
// Runtime Manager (gating on ELLAMAKA_DSH internally, DESIGN-dsh-poc §3.4.4)
// and mounts only on `ready`.
describe("server entry points wire the shared dsh assembly", () => {
  const cases = [
    { cmd: "serve", path: "../../../src/cli/cmd/serve.ts" },
    { cmd: "web", path: "../../../src/cli/cmd/web.ts" },
  ]
  for (const { cmd, path } of cases) {
    test(`${cmd} delegates to mountDshEngine (manager gates ELLAMAKA_DSH internally)`, () => {
      const source = readFileSync(join(import.meta.dir, path), "utf-8")
      expect(source).toContain("mountDshEngine")
      // The manual kill-switch check is gone: the manager gates internally, so
      // the entry must NOT short-circuit on Flag.ELLAMAKA_DSH itself.
      expect(source).not.toContain("if (Flag.ELLAMAKA_DSH)")
    })
  }

  test("dsh-mount drives the runtime manager and injects the resolved runtime", () => {
    const source = readFileSync(join(import.meta.dir, "../../../src/cli/cmd/dsh-mount.ts"), "utf-8")
    expect(source).toContain("initializeDshRuntime")
    expect(source).toContain("resolveInstallAnchor")
    expect(source).toContain("createDshRuntimeApi")
    expect(source).toContain('entry: opts.entry ?? "serve"')
  })

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
