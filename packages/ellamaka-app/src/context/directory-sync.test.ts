import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { reconcileActiveSessions } from "./directory-sync"

const message = (id: string, sessionID: string): Message =>
  ({
    id,
    sessionID,
    role: "assistant",
    time: { created: 1 },
  }) as Message

describe("reconcileActiveSessions", () => {
  test("does not sync when cached tail matches the latest server message", async () => {
    const synced: string[] = []
    reconcileActiveSessions({
      store: { message: { ses_1: [message("m1", "ses_1"), message("m2", "ses_1")] } },
      loading: {},
      keyFor: (dir, id) => `${dir}\n${id}`,
      directory: "dir",
      fetchLatest: async () => "m2",
      sync: (id) => {
        synced.push(id)
      },
    })
    await Promise.resolve()
    expect(synced).toEqual([])
  })

  test("forces sync when the cached tail is stale after a reconnect", async () => {
    const synced: Array<{ id: string; force: boolean }> = []
    reconcileActiveSessions({
      store: { message: { ses_1: [message("m1", "ses_1"), message("m2", "ses_1")] } },
      loading: {},
      keyFor: (dir, id) => `${dir}\n${id}`,
      directory: "dir",
      fetchLatest: async () => "m3",
      sync: (id, opts) => {
        synced.push({ id, force: opts.force })
      },
    })
    await Promise.resolve()
    expect(synced).toEqual([{ id: "ses_1", force: true }])
  })

  test("skips sessions that are already loading", async () => {
    const synced: string[] = []
    reconcileActiveSessions({
      store: { message: { ses_1: [message("m1", "ses_1")] } },
      loading: { "dir\nses_1": true },
      keyFor: (dir, id) => `${dir}\n${id}`,
      directory: "dir",
      fetchLatest: async () => "m2",
      sync: (id) => {
        synced.push(id)
      },
    })
    await Promise.resolve()
    expect(synced).toEqual([])
  })

  test("ignores empty caches and missing latest id", async () => {
    const synced: string[] = []
    reconcileActiveSessions({
      store: { message: { ses_1: [] } },
      loading: {},
      keyFor: (dir, id) => `${dir}\n${id}`,
      directory: "dir",
      fetchLatest: async () => undefined,
      sync: (id) => {
        synced.push(id)
      },
    })
    await Promise.resolve()
    expect(synced).toEqual([])
  })
})
