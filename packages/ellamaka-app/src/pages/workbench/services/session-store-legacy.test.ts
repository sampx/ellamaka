import { describe, expect, test } from "bun:test"
import { LEGACY_SESSION_STORAGE_KEY, removeLegacySessionStorage } from "./session-store-legacy"

describe("removeLegacySessionStorage", () => {
  test("deletes the legacy full Session projection without reading it", () => {
    const calls: string[] = []
    const storage = {
      removeItem(key: string) {
        calls.push(key)
      },
    }

    expect(removeLegacySessionStorage(storage)).toBe(true)
    expect(calls).toEqual([LEGACY_SESSION_STORAGE_KEY])
  })

  test("does not fail startup when storage removal is unavailable", () => {
    expect(removeLegacySessionStorage(undefined)).toBe(false)
  })
})
