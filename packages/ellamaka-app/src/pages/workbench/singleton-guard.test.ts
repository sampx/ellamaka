import { describe, expect, test } from "bun:test"
import { requestWorkbenchLock } from "./singleton-guard"

function createMockLocks(available: boolean) {
  return {
    request(
      _name: string,
      _options: { ifAvailable?: boolean },
      callback: (lock: { name: string } | null) => Promise<void>,
    ): Promise<void> {
      if (available) {
        return callback({ name: "ellamaka-workbench-instance" })
      }
      return callback(null)
    },
  }
}

describe("requestWorkbenchLock", () => {
  test("returns locked state when lock is available (first instance)", async () => {
    const locks = createMockLocks(true)

    const result = await requestWorkbenchLock(locks)

    expect(result.state).toBe("locked")
    expect(result.release).toBeDefined()
  })

  test("returns blocked state when lock is not available (another instance holds it)", async () => {
    const locks = createMockLocks(false)

    const result = await requestWorkbenchLock(locks)

    expect(result.state).toBe("blocked")
    expect(result.release).toBeUndefined()
  })

  test("returns locked state when no locks API is available (fallback)", async () => {
    const result = await requestWorkbenchLock(undefined)

    expect(result.state).toBe("locked")
    expect(result.release).toBeUndefined()
  })

  test("release function allows re-acquisition of the lock", async () => {
    const locks = createMockLocks(true)

    const first = await requestWorkbenchLock(locks)
    expect(first.state).toBe("locked")
    expect(first.release).toBeDefined()

    // Release the lock
    first.release!()

    // After release, a new request should succeed
    const second = await requestWorkbenchLock(locks)
    expect(second.state).toBe("locked")
    expect(second.release).toBeDefined()
  })
})
