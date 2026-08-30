import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * Cross-process materialisation mutex (DESIGN §3.4.2 / D-04).
 *
 * The lock is a Guard directory created with an atomic `mkdir`: only one
 * process can win the create, so concurrent Ellamaka processes cannot both
 * download and install. Ownership is recorded in an `owner.json` inside the
 * guard so a lock abandoned by a crashed owner can be reaped, while a lock
 * held by a live process is never stolen.
 *
 * Ownership-safe removal (B-04 / round-1): every destructive path re-reads
 * `owner.json` immediately before removing the guard and only removes it when
 * the recorded owner still matches the caller's expectation — a stale-pid
 * token for a reclaim, or an exact `{pid,time}` token for a release. A
 * mismatched guard is a no-op, never a delete.
 *
 * Atomic reclaim protocol (B-01 / round-2): the check-then-rm reclaim window
 * is closed with a separate exclusive guard `materialize.lock.reclaim`, also
 * created with a non-recursive atomic `mkdirSync`. Only the single winner of
 * that reclaim guard may re-read `owner.json`, verify staleness, delete the
 * old guard, and then remove the reclaim guard. Every other waiter that
 * observes a stale-looking lock must NOT delete anything — it waits for the
 * reclaim guard to disappear, then re-loops. This serialises the
 * read-owner→rm window so a slower waiter can never delete a guard another
 * process has just reclaimed and re-created.
 *
 * There is no lease and no GC — this is a pure mutual-exclusion guard for the
 * materialisation window. A live-but-hung owner holds the lock until it dies;
 * the atomic reclaim then reaps it on the next launch (see manager.ts W-01
 * decision note).
 */

const OWNER_FILE = "owner.json"
/** The reclaim guard suffix: a sibling dir serialising the reclaim window. */
const RECLAIM_SUFFIX = ".reclaim"

export interface LockToken {
  /** Process id of the lock owner. */
  pid: number
  /** Epoch ms when the lock was acquired. */
  time: number
}

/**
 * Test-injection hooks for the lock protocol (B-01 round-2). These let tests
 * force deterministic interleavings of the atomic-reclaim window without
 * relying on wall-clock timing. Production callers omit `deps`.
 */
export interface LockDeps {
  /**
   * Override owner.json reading. Returns the parsed token, or `undefined` when
   * the guard has no readable owner. Defaults to reading `owner.json` from disk.
   */
  readOwner?: (ownerPath: string) => LockToken | undefined
  /**
   * Hook invoked after the caller wins the reclaim guard, immediately before
   * it deletes the stale guard. Tests use this to hold the reclaim window open
   * and force the interleaving under test.
   */
  beforeDeleteGuard?: (lockPath: string) => void | Promise<void>
}

/**
 * Try to acquire the materialisation lock, waiting up to `timeoutMs` for a
 * currently held lock to be released. Returns the ownership token on success,
 * `null` on timeout.
 *
 * A lock whose recorded owner pid is no longer alive is considered stale and
 * is reaped (removed) so a crash never wedges materialisation forever. The
 * reap is serialised via the atomic reclaim guard (B-01).
 */
export async function acquireMaterializeLock(
  lockPath: string,
  timeoutMs: number,
  deps: LockDeps = {},
): Promise<LockToken | null> {
  const deadline = Date.now() + timeoutMs
  const token: LockToken = { pid: process.pid, time: Date.now() }
  const reclaimPath = `${lockPath}${RECLAIM_SUFFIX}`
  // Ensure the parent locks dir exists; the leaf create below stays
  // non-recursive so a concurrent holder still surfaces as EEXIST.
  mkdirSync(dirname(lockPath), { recursive: true })
  for (;;) {
    // Fast path: try to win the main guard atomically.
    try {
      mkdirSync(lockPath)
      writeFileSync(join(lockPath, OWNER_FILE), JSON.stringify(token))
      return token
    } catch {
      // The main guard is held by someone (or a race). Only reclaim a stale
      // owner — and only under the atomic reclaim guard.
    }

    if (Date.now() >= deadline) return null

    if (!isStaleLock(lockPath, deps)) {
      await sleep(30)
      continue
    }

    // The lock looks stale. Serialise the reclaim via the exclusive reclaim
    // guard: only its winner may read owner, verify staleness, delete the old
    // guard and drop the reclaim guard. Losers wait for the reclaim guard to
    // disappear, then re-loop — they never delete.
    try {
      mkdirSync(reclaimPath)
    } catch {
      // Another process holds the reclaim guard. Wait for it to finish, then
      // re-loop (it may have re-created a live guard we must respect).
      await sleep(30)
      continue
    }

    // We own the reclaim guard. Re-read owner, verify it is still stale, then
    // delete the old guard and drop the reclaim guard (B-01).
    try {
      if (isStaleLock(lockPath, deps)) {
        await deps.beforeDeleteGuard?.(lockPath)
        rmSync(lockPath, { recursive: true, force: true })
      }
    } finally {
      rmSync(reclaimPath, { recursive: true, force: true })
    }
    // Re-loop: the main guard is gone (or was not stale) — try to win it.
  }
}

/** Whether the lock is held by an owner pid that no longer exists. */
function isStaleLock(lockPath: string, deps: LockDeps): boolean {
  const owner = readOwner(lockPath, deps)
  if (typeof owner?.pid !== "number") return false
  // signal(0) is a pure existence probe; ESRCH means the pid is gone.
  try {
    process.kill(owner.pid, 0)
    return false
  } catch {
    return true
  }
}

/** Read the guard's owner token, honoring the injected `deps.readOwner` hook. */
function readOwner(lockPath: string, deps: LockDeps): LockToken | undefined {
  try {
    const ownerPath = join(lockPath, OWNER_FILE)
    if (!existsSync(ownerPath)) return undefined
    if (deps.readOwner) return deps.readOwner(ownerPath)
    return JSON.parse(readFileSync(ownerPath, "utf8")) as LockToken
  } catch {
    return undefined
  }
}

/**
 * Release a held materialisation lock. Only the guard whose `owner.json`
 * exactly matches the caller's `{pid,time}` token is removed; anything else
 * (a lock now owned by another process, or a foreign/stale guard) is a no-op.
 * This guarantees a delayed release never deletes a guard another process
 * acquired after this one gave up.
 */
export async function releaseMaterializeLock(lockPath: string, token: LockToken): Promise<void> {
  if (!existsSync(lockPath)) return
  let current: LockToken | undefined
  try {
    const ownerPath = join(lockPath, OWNER_FILE)
    if (!existsSync(ownerPath)) return
    const parsed = JSON.parse(readFileSync(ownerPath, "utf8")) as Partial<LockToken>
    if (parsed.pid === token.pid && parsed.time === token.time) current = parsed as LockToken
  } catch {
    return
  }
  if (!current) return
  rmSync(lockPath, { recursive: true, force: true })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
