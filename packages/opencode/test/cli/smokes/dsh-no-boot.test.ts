import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"

// The dsh command group is a lightweight shim over profile composition files
// (DESIGN-dsh-poc: "ellamaka dsh is the Bun executor stand-in for the official
// dsh CLI"; dump-config is documented "without booting"). These tests pin the
// no-boot contract at the process boundary: the engine's boot side effects
// (SQLite DB open/migrate, provider layer, models.dev fetch) must NEVER run
// for dsh subcommands — even in a fresh empty home where every boot step
// would leave a log trace. Behaviour assertions (exit codes, payloads) pin
// the functional surface; the --print-logs absence assertions pin the
// lightweight execution path itself.

const BOOT_TRACES = ["opening database", "failed to run data migrations", "service=provider"]

describe("dsh CLI: no-engine-boot contract", () => {
  cliIt.live(
    "dsh plugin list: exits 0 on an empty home without any engine boot trace",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["dsh", "plugin", "list", "--json", "--print-logs"])
        expect(r.exitCode).toBe(0)
        expect(JSON.parse(r.stdout)).toEqual({ plugins: [] })
        for (const trace of BOOT_TRACES) {
          expect(r.stderr).not.toContain(trace)
        }
      }),
    15_000,
  )

  cliIt.live(
    "dsh dump-config: exits non-zero without any engine boot trace (no closure in empty home)",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["dsh", "dump-config", "--profile", "web", "--print-logs"])
        expect(r.exitCode).not.toBe(0)
        expect(r.stderr + r.stdout).toContain("closure not found")
        for (const trace of BOOT_TRACES) {
          expect(r.stderr).not.toContain(trace)
        }
      }),
    15_000,
  )

  cliIt.live(
    "dsh plugin add github spec: rejected fast with npm guidance, no boot trace",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["dsh", "plugin", "add", "github:owner/repo", "--print-logs"])
        expect(r.exitCode).not.toBe(0)
        expect(r.stderr + r.stdout).toContain("npm")
        for (const trace of BOOT_TRACES) {
          expect(r.stderr).not.toContain(trace)
        }
      }),
    15_000,
  )
})
