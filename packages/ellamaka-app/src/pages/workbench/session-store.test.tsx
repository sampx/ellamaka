import { describe, expect, test } from "bun:test"
import { serverSessionReferenceUpdates } from "./session-store"

describe("ensureSessionReference", () => {
  test("replaces a stale local title with the authoritative server title", () => {
    expect(
      serverSessionReferenceUpdates({
        title: "New session - 2026-07-09T04:04:53.724Z",
        type: "chat",
        projectPath: "/repo",
      }),
    ).toEqual({
      title: "New session - 2026-07-09T04:04:53.724Z",
      type: "chat",
      projectPath: "/repo",
    })
  })
})
