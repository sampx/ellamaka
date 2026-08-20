import { readdirSync } from "node:fs"
import { join } from "node:path"

export type RunMode = "unit" | "slow" | "all"

// Heavy directories measured as slow in ../../perf/test-suite.md; excluded from
// the default unit subset. Kept as a source constant so the slow list is explicit.
export const SLOW_DIRS = ["server", "session", "cli", "snapshot", "project", "tool", "control-plane"]

// Returns the directory arguments to pass to `bun test` for the given mode.
// testRoot is injected so tests can exercise the scan against a temp directory.
export function planning(mode: RunMode, testRoot: string): string[] {
  switch (mode) {
    case "unit": {
      const dirs = readdirSync(testRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => !SLOW_DIRS.includes(name))
        .map((name) => `test/${name}`)
      const topFiles = readdirSync(testRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
        .map((entry) => `test/${entry.name}`)
      return [...dirs, ...topFiles].sort()
    }
    case "slow":
      return SLOW_DIRS.map((name) => `test/${name}`)
    case "all":
      return []
    default:
      throw new Error(`Invalid test mode: ${String(mode)}`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  let mode: RunMode = "unit"
  const bunArgs: string[] = []

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === "--mode") {
      const value = args[++index]
      if (value === "unit" || value === "slow" || value === "all") {
        mode = value
      } else {
        console.error(`Unknown mode: ${value}. Expected one of unit, slow, all.`)
        process.exit(1)
      }
    } else if (arg === "--") {
      bunArgs.push(...args.slice(index + 1))
      break
    } else {
      bunArgs.push(arg)
    }
  }

  const testRoot = join(import.meta.dir, "..", "test")
  const dirs = planning(mode, testRoot)

  // TEST_PLAN_OUTPUT=1 prints the planned directory list instead of running tests.
  if (Bun.env.TEST_PLAN_OUTPUT === "1") {
    console.log(JSON.stringify({ mode, dirs }, null, 2))
    return
  }

  const command = ["bun", "test", "--timeout", "30000", "--force-exit", ...dirs, ...bunArgs]
  const proc = Bun.spawn(command, {
    cwd: import.meta.dir + "/..",
    stdout: "inherit",
    stderr: "inherit",
    env: Bun.env,
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) process.exit(exitCode ?? 1)
}

if (import.meta.main) {
  main()
}
