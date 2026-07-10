import { describe, expect, test } from "bun:test"
import type { Session } from "../session-store"

// Re-implement the purge function inline to test the logic
function purgeFabricatedSessions(value: unknown): unknown {
  if (!value || typeof value !== "object") return value
  const v = value as { spaces?: Record<string, Session[]> }
  if (!v.spaces || typeof v.spaces !== "object") return value
  const cleaned: Record<string, Session[]> = {}
  for (const [spaceName, sessions] of Object.entries(v.spaces)) {
    if (!Array.isArray(sessions)) continue
    cleaned[spaceName] = sessions.filter((s) => !s.id.startsWith("s-"))
  }
  return { spaces: cleaned }
}

describe("purgeFabricatedSessions", () => {
  test("removes sessions with s- prefix IDs (local-only fabrications)", () => {
    const input = {
      spaces: {
        "wopal-workspace": [
          { id: "s-mrbcdguy-1", title: "wopal-workspace chat" },
          { id: "ses_0baf336a3ffeXdXknpWKhT0BZ1", title: "New session - 2026-07-09T04:04:53.724Z" },
          { id: "s-mrc7op1q-1", title: "wopal-workspace chat" },
          { id: "ses_0bd87605effew7Y4toSGdf00aA", title: "你好呀" },
        ],
      },
    }
    const result = purgeFabricatedSessions(input) as { spaces: { "wopal-workspace": Session[] } }
    const ids = result.spaces["wopal-workspace"].map((s) => s.id)
    expect(ids).toEqual(["ses_0baf336a3ffeXdXknpWKhT0BZ1", "ses_0bd87605effew7Y4toSGdf00aA"])
    expect(ids).not.toContain("s-mrbcdguy-1")
    expect(ids).not.toContain("s-mrc7op1q-1")
  })

  test("passes through undefined or non-object values unchanged", () => {
    expect(purgeFabricatedSessions(undefined)).toBe(undefined)
    expect(purgeFabricatedSessions(null)).toBe(null)
    expect(purgeFabricatedSessions("string")).toBe("string")
  })

  test("passes through objects without spaces field", () => {
    const input = { other: "data" }
    expect(purgeFabricatedSessions(input)).toBe(input)
  })
})
