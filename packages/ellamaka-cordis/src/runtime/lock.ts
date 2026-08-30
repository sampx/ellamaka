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
      // if we can prove it is dead, then retry.
      if (isStaleLock(lockPath)) {
        rmSync(lockPath, { recursive: true, force: true })
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
 * Release a held materialisation lock. Removing only the exact guard directory
 * named `lockPath` means a stale/foreign lock is never deleted; the token is
 * informational and release is a no-op when nothing is held.
 */
export async function releaseMaterializeLock(lockPath: string, _token: LockToken): Promise<void> {
  rmSync(lockPath, { recursive: true, force: true })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
