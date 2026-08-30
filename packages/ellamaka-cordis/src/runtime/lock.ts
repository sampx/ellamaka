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
 * Ownership-safe removal (B-04): every destructive path re-reads `owner.json`
 * immediately before removing the guard and only removes it when the recorded
 * owner still matches the caller's expectation — a stale-pid token for a
 * reclaim, or an exact `{pid,time}` token for a release. A mismatched guard is
 * a no-op (logged to stderr), never a delete. This closes the classic
 * wait-loop race where two waiters both observe a stale owner and the slower
 * `rmSync` deletes the faster waiter's freshly created guard.
 *
 * Residual TOCTOU: `owner.json` is checked and then `rmSync` runs non-atomically,
 * so between the read and the remove another process could (a) release and
 * re-acquire the guard (a different owner.json) or (b) replace the owner file.
 * Both paths re-read immediately before removal and verify the exact token, so
 * the window is a single unpaired read+remove; because a fresh guard is only
 * ever created after the old one is fully gone, an interleaving can at worst
 * no-op the delete, never delete another owner's live guard.
 *
 * There is no lease and no GC — this is a pure mutual-exclusion guard for the
 * materialisation window.
 */

const OWNER_FILE = "owner.json"

export interface LockToken {
  /** Process id of the lock owner. */
  pid: number
  /** Epoch ms when the lock was acquired. */
  time: number
}

/**
 * Try to acquire the materialisation lock, waiting up to `timeoutMs` for a
 * currently held lock to be released. Returns the ownership token on success,
 * `null` on timeout.
 *
 * A lock whose recorded owner pid is no longer alive is considered stale and
 * is reaped (removed) so a crash never wedges materialisation forever.
 */
export async function acquireMaterializeLock(
  lockPath: string,
  timeoutMs: number,
): Promise<LockToken | null> {
  const deadline = Date.now() + timeoutMs
  const token: LockToken = { pid: process.pid, time: Date.now() }
  // Ensure the parent locks dir exists; the leaf create below stays
  // non-recursive so a concurrent holder still surfaces as EEXIST.
  mkdirSync(dirname(lockPath), { recursive: true })
  for (;;) {
    try {
      mkdirSync(lockPath)
      // We won the atomic create: we are the holder.
      writeFileSync(join(lockPath, OWNER_FILE), JSON.stringify(token))
      return token
    } catch {
      // Someone else holds (or is racing for) the guard. Reap a stale owner
      // only if we can prove it is dead AND it is still the guard owner at
      // removal time; otherwise retry. A re-read before removal closes the
      // race where two waiters both see a stale pid and the slower rm deletes
      // the faster waiter's freshly created guard.
      if (isStaleLock(lockPath) && removeOwnedByStalePid(lockPath)) {
        continue
      }
      if (Date.now() >= deadline) return null
      await sleep(30)
    }
  }
}

/** Whether the lock is held by an owner pid that no longer exists. */
function isStaleLock(lockPath: string): boolean {
  try {
    const ownerPath = join(lockPath, OWNER_FILE)
    if (!existsSync(ownerPath)) return false
    const token = JSON.parse(readFileSync(ownerPath, "utf8")) as Partial<LockToken>
    if (typeof token.pid !== "number") return false
    // signal(0) is a pure existence probe; ESRCH means the pid is gone.
    try {
      process.kill(token.pid, 0)
      return false
    } catch {
      return true
    }
  } catch {
    return false
  }
}

/**
 * Remove the guard only when its `owner.json` still records a dead pid
 * (ownership re-read immediately before removal). Returns whether the guard
 * was actually removed. A lock whose owner.json no longer shows the dead pid
 * (another process reclaimed or replaced it meanwhile) is left untouched.
 */
function removeOwnedByStalePid(lockPath: string): boolean {
  try {
    const ownerPath = join(lockPath, OWNER_FILE)
    if (!existsSync(ownerPath)) return false
    const token = JSON.parse(readFileSync(ownerPath, "utf8")) as Partial<LockToken>
    if (typeof token.pid !== "number") return false
    try {
      process.kill(token.pid, 0)
      // The owner came back to life between the check and here — never steal.
      return false
    } catch {
      // pid is still gone; remove the guard and prove it is gone.
      rmSync(lockPath, { recursive: true, force: true })
      return !existsSync(lockPath)
    }
  } catch {
    return false
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
