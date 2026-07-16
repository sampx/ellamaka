import { describe, expect, test } from "bun:test"
import { requestWorkbenchLock } from "./singleton-guard"

function createMockLocks() {
  let held = false
  return {
    request(
      _name: string,
      _options: { ifAvailable?: boolean },
      callback: (lock: { name: string } | null) => Promise<void>,
    ): Promise<void> {
      if (held) return callback(null)
      held = true
      return callback({ name: "ellamaka-workbench-instance" }).finally(() => {
        held = false
      })
    },
  }
}

describe("requestWorkbenchLock", () => {
  test("returns locked state when lock is available (first instance)", async () => {
    const locks = createMockLocks()

    const result = await requestWorkbenchLock(locks)

    expect(result.state).toBe("locked")
    expect(result.release).toBeDefined()
  })

  test("returns blocked state when another instance holds the lock", async () => {
    const locks = createMockLocks()
    const first = await requestWorkbenchLock(locks)

    const result = await requestWorkbenchLock(locks)

    expect(result.state).toBe("blocked")
    expect(result.release).toBeUndefined()
    first.release?.()
  })

  test("returns locked state when no locks API is available (fallback)", async () => {
    const result = await requestWorkbenchLock(undefined)

    expect(result.state).toBe("locked")
    expect(result.release).toBeUndefined()
  })

  test("release function allows re-acquisition of the lock", async () => {
    const locks = createMockLocks()

    const first = await requestWorkbenchLock(locks)
    expect(first.state).toBe("locked")
    expect(first.release).toBeDefined()

    if (!first.release) throw new Error("expected first lock to expose release")
    first.release()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // After release, a new request should succeed
    const second = await requestWorkbenchLock(locks)
    expect(second.state).toBe("locked")
    expect(second.release).toBeDefined()
  })
})
