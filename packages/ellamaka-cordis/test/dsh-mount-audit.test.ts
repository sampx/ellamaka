import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * B-01 audit: production mount paths must never fall back to the host package
 * closure.
 *
 * Packaged hosts (CLI bundle, Desktop sidecar) ship WITHOUT `@deepseek-ai/*`
 * in their own closure, so `new CordisHub(null)` with no injected context, or
 * any lazy `createPackageDshRuntimeApi()` fallback reached at mount time,
 * fails at runtime on a packaged host.
 *
 * This is a static scan over the entry files asserting the production mount
 * call sites always:
 *  - construct `CordisHub` with an injected `{ context: ... }` from the
 *    closure-resolved runtime, and
 *  - pass `runtime` to `bootDshWeb`/`bootDshTools`/`mountDshWeb`/`mountDshTools`.
 *
 * The audit intentionally greps the files (read-only, no network, no package
 * install) so a regression that reintroduces a bare `new CordisHub(null)` in a
 * prod entry fails the gate.
 */
describe("B-01: production mount sites inject the closure-resolved runtime", () => {
  const entries = [
    // CLI serve/web assembly.
    {
      path: "packages/opencode/src/cli/cmd/dsh-mount.ts",
      // The hub must be constructed with an injected closure context, never a
      // bare `new CordisHub(null)` (which falls back to the package closure).
      mustNotMatch: [/new CordisHub\(null\)/],
      mustMatch: [/new CordisHub\(null, \{ context: new runtime\.cordis\.Context\(\) \}\)/],
    },
    // TUI tool container.
    {
      path: "packages/opencode/src/cli/cmd/tui/dsh-mount.ts",
      mustNotMatch: [/new CordisHub\(null\)/],
      mustMatch: [/new CordisHub\(null, \{ context: new runtime\.cordis\.Context\(\) \}\)/],
    },
    // Desktop sidecar — uses bootDshWeb/bootDshTools, which build the hub from
    // the injected runtime themselves; the runtime must be passed in.
    {
      path: "packages/ellamaka-desktop/src/main/sidecar.ts",
      mustNotMatch: [/new CordisHub\(/],
      // Both mounts pass the closure runtime into the boot entry points.
      mustMatch: [/bootDshWeb\(\{[\s\S]*?runtime,/, /bootDshTools\(\{[\s\S]*?runtime,/],
    },
  ]

  // B-06 / W-02 code-level guarantees for the Desktop sidecar: the dsh mounts
  // must be wrapped in a degrade boundary (catch, log, continue — never
  // process.exit) and initialise the runtime once per launch (shared state).
  test("desktop sidecar dsh mounts degrade (no exit) and initialise once per launch", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "..", "packages", "ellamaka-desktop", "src", "main", "sidecar.ts"),
      "utf-8",
    )
    // Both mount functions catch and continue (B-06).
    expect(source).toMatch(/dsh web mount failed/)
    expect(source).toMatch(/dsh tool container mount failed/)
    // The runtime is initialised once per launch (W-02).
    expect(source).toMatch(/initDshLaunch/)
    expect(source).toMatch(/dshLaunchState/)
  })

  for (const entry of entries) {
    test(`mount site ${entry.path} injects the closure runtime (no bare-hub fallback)`, () => {
      // test/ -> ellamaka-cordis (..) -> packages (..) -> worktree root (..).
      const abs = join(import.meta.dir, "..", "..", "..", entry.path)
      const source = readFileSync(abs, "utf-8")
      for (const re of entry.mustNotMatch) {
        expect(source).not.toMatch(re)
      }
      for (const re of entry.mustMatch) {
        expect(source).toMatch(re)
      }
    })
  }
})
