import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { applyLockUpdate, parseArgs } from "../src/upstream-lock"

function makeTempLock() {
  const dir = mkdtempSync(join(tmpdir(), "ellamaka-lock-test-"))
  const lockPath = join(dir, "upstreams.lock.json")
  const lock = {
    schemaVersion: 1,
    sources: {
      opencode: {
        relationship: "baseline",
        repository: "https://github.com/anomalyco/opencode.git",
        version: "1.18.9",
        gitCommit: "a".repeat(40),
      },
    },
  }
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n")
  return { dir, lockPath }
}

describe("update-upstream-lock", () => {
  test("dry-run does not write the lock file", () => {
    const { dir, lockPath } = makeTempLock()
    const before = readFileSync(lockPath, "utf8")
    process.env.OPENCODE_UPSTREAM_COMMIT = "b".repeat(40)
    try {
      applyLockUpdate({ dryRun: true, version: "1.18.10", lockPath })
    } finally {
      delete process.env.OPENCODE_UPSTREAM_COMMIT
    }
    const after = readFileSync(lockPath, "utf8")
    expect(after).toBe(before)
    rmSync(dir, { recursive: true, force: true })
  })

  test("parseArgs accepts engine mode with version and dry-run", () => {
    const flags = parseArgs(["node", "upstream-lock.ts", "engine", "--version", "1.18.10", "--dry-run"])
    expect(flags.mode).toBe("engine")
    expect(flags.version).toBe("1.18.10")
    expect(flags.dryRun).toBe(true)
  })
})
