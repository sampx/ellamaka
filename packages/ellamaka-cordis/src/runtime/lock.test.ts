import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireMaterializeLock, releaseMaterializeLock } from "./lock"

const dirs: string[] = []

function tmpHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "dsh-lock-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("materialize lock (real tmp paths)", () => {
  test("acquire creates a lock dir and release removes it", async () => {
    const lockPath = join(tmpHome(), "locks", "materialize.lock")
    const token = await acquireMaterializeLock(lockPath, 50)
    expect(token).not.toBeNull()
    expect(await acquireMaterializeLock(lockPath, 50)).toBeNull() // still held
    await releaseMaterializeLock(lockPath, token!)
    expect(await acquireMaterializeLock(lockPath, 50)).not.toBeNull() // acquirable again
    await releaseMaterializeLock(lockPath, (await acquireMaterializeLock(lockPath, 50))!)
  })

  test("second acquire while held returns null (mutual exclusion)", async () => {
    const lockPath = join(tmpHome(), "locks", "materialize.lock")
    const token = await acquireMaterializeLock(lockPath, 200)
    expect(token).not.toBeNull()
    expect(await acquireMaterializeLock(lockPath, 50)).toBeNull()
    await releaseMaterializeLock(lockPath, token!)
  })

  test("release without holding is a harmless no-op", async () => {
    const lockPath = join(tmpHome(), "locks", "materialize.lock")
    await releaseMaterializeLock(lockPath, { pid: process.pid, time: Date.now() })
  })

  test("stale lock held by a dead owner is reaped by pid token", async () => {
    const lockPath = join(tmpHome(), "locks", "materialize.lock")
    // Simulate a lock left behind by a crashed process whose pid is no longer alive.
    mkdirSync(lockPath, { recursive: true })
    const deadToken = JSON.stringify({ pid: 999999999, time: Date.now() })
    const { writeFileSync } = await import("node:fs")
    writeFileSync(join(lockPath, "owner.json"), deadToken)
    const token = await acquireMaterializeLock(lockPath, 50)
    expect(token).not.toBeNull()
    await releaseMaterializeLock(lockPath, token!)
  })
})
