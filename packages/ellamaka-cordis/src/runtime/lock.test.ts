import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

/** Wait for the child to print a single line on stdout (readiness). */
async function waitForLine(proc: Bun.Subprocess): Promise<string> {
  const reader = proc.stdout.getReader()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += new TextDecoder().decode(value)
    const at = buffer.indexOf("\n")
    if (at !== -1) return buffer.slice(0, at).trim()
  }
  return buffer.trim()
}

/** Spawn a real `bun` child running a lock-child.ts command. */
function spawnChild(lockPath: string, args: string[]): Bun.Subprocess {
  const helper = join(import.meta.dir, "fixtures", "lock-child.ts")
  return Bun.spawn(["bun", "run", helper, lockPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
}

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
    writeFileSync(join(lockPath, "owner.json"), deadToken)
    const token = await acquireMaterializeLock(lockPath, 50)
    expect(token).not.toBeNull()
    await releaseMaterializeLock(lockPath, token!)
  })

  test("release never deletes a guard now owned by another process", async () => {
    const lockPath = join(tmpHome(), "locks", "materialize.lock")
    // A stale token from a past/foreign owner: release must not touch the guard.
    const foreignToken = { pid: process.pid, time: Date.now() - 1 }
    const token = await acquireMaterializeLock(lockPath, 50)
    expect(token).not.toBeNull()
    await releaseMaterializeLock(lockPath, foreignToken)
    expect(existsSync(lockPath)).toBe(true)
    expect(existsSync(join(lockPath, "owner.json"))).toBe(true)
    await releaseMaterializeLock(lockPath, token!)
  })
})

describe("materialize lock — real two-child-process races (B-04)", () => {
  test(
    "two waiters on a stale guard: the slower reclaim must not delete the faster waiter's fresh guard",
    async () => {
      const lockPath = join(tmpHome(), "locks", "materialize.lock")
      // Simulate a crash-orphaned guard owned by a dead pid.
      mkdirSync(lockPath, { recursive: true })
      writeFileSync(join(lockPath, "owner.json"), JSON.stringify({ pid: 999999999, time: Date.now() }))

      // Two real children race to reclaim the stale guard. Whichever wins owns
      // the lock; the loser must retry and see the winner's (live) owner.json —
      // the loser's reclaim must NOT delete the winner's guard.
      const [a, b] = await Promise.all([
        spawnChild(lockPath, ["acquire", "100"]).exited,
        spawnChild(lockPath, ["acquire", "100"]).exited,
      ])
      expect(a).toBe(0)
      expect(b).toBe(0)
      // The guard is gone: the winner released after its hold elapsed.
      expect(existsSync(lockPath)).toBe(false)
    },
    20_000,
  )

  test(
    "a stale guard is re-acquirable by a real child after reclaim",
    async () => {
      const lockPath = join(tmpHome(), "locks", "materialize.lock")
      mkdirSync(lockPath, { recursive: true })
      writeFileSync(join(lockPath, "owner.json"), JSON.stringify({ pid: 999999999, time: Date.now() }))
      const child = spawnChild(lockPath, ["acquire", "50"])
      expect(await child.exited).toBe(0)
      // After the child reclaimed and released, the guard is fully gone and the
      // parent can acquire it again.
      const token = await acquireMaterializeLock(lockPath, 50)
      expect(token).not.toBeNull()
      await releaseMaterializeLock(lockPath, token!)
    },
    20_000,
  )

  test(
    "delayed release of a stale token does not delete a guard re-acquired by another process",
    async () => {
      const lockPath = join(tmpHome(), "locks", "materialize.lock")
      // Process A acquires and then releases with a STALE token that does not
      // match its own owner record, simulating a delayed release from an old
      // generation racing a re-acquire.
      const a = spawnChild(lockPath, ["release", String(Date.now() - 1000)])
      // Wait for A's release to settle (it is a no-op since nothing is held).
      expect(await a.exited).toBe(0)

      // Process B then acquires and holds; A's delayed release must not delete B's guard.
      const b = spawnChild(lockPath, ["acquireAndHold"])
      expect(await waitForLine(b)).toBe("READY")
      expect(existsSync(lockPath)).toBe(true)

      // A's delayed release (with the stale token) is a no-op on B's live guard.
      const owner = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8"))
      await releaseMaterializeLock(lockPath, { pid: process.pid, time: owner.time })
      expect(existsSync(lockPath)).toBe(true)

      b.kill()
      await b.exited
      // With the holder gone, the guard may remain orphaned (its pid is the
      // child's, still alive? no — the child was killed). Clean it up.
      rmSync(lockPath, { recursive: true, force: true })
    },
    20_000,
  )

  test(
    "a release with the caller's own token removes exactly its own guard",
    async () => {
      const lockPath = join(tmpHome(), "locks", "materialize.lock")
      const token = await acquireMaterializeLock(lockPath, 50)
      expect(token).not.toBeNull()
      // A different token (same pid, different time) must not release it.
      await releaseMaterializeLock(lockPath, { pid: process.pid, time: token!.time + 1 })
      expect(existsSync(lockPath)).toBe(true)
      await releaseMaterializeLock(lockPath, token!)
      expect(existsSync(lockPath)).toBe(false)
    },
  )
})
