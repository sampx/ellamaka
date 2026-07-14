import { describe, expect, test } from "bun:test"
import type { Session } from "../session-store"
import { limitSessions } from "./session-store-service"

const session = (index: number): Session => ({
  id: `session-${index}`,
  spaceName: "Space A",
  projectPath: "/fixtures/space-a",
  type: "chat",
  title: `Session ${index}`,
  directoryHealth: "healthy",
  createdAt: index,
  lastActiveAt: index,
})

describe("limitSessions", () => {
  test("keeps the 50 most recently updated server projections", () => {
    const result = limitSessions(Array.from({ length: 55 }, (_, index) => session(index)))

    expect(result).toHaveLength(50)
    expect(result[0]?.id).toBe("session-54")
    expect(result.at(-1)?.id).toBe("session-5")
  })
})
