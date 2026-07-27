import { describe, expect, test } from "bun:test"
import { createSessionProjection, type Session } from "./session-store"

const serverSession = (updates: Partial<Session> = {}): Session => ({
  id: "session-a",
  spaceName: "Space A",
  projectPath: "/fixtures/space-a",
  type: "chat",
  title: "Server title",
  directoryHealth: "healthy",
  createdAt: 10,
  lastActiveAt: 20,
  ...updates,
})

describe("SessionProjection", () => {
  test("replaces stale fields with the latest authoritative server projection", () => {
    const projection = createSessionProjection()

    projection.writer.upsert(serverSession({ title: "Old title", lastActiveAt: 15 }))
    projection.writer.upsert(serverSession())

    expect(projection.reader.getSession("session-a")).toEqual(serverSession())
  })

  test("moves a Session when the server projection changes its owning Space", () => {
    const projection = createSessionProjection()

    projection.writer.upsert(serverSession())
    projection.writer.upsert(serverSession({ spaceName: "Space B", projectPath: "/fixtures/space-b" }))

    expect(projection.reader.spaceSessions("Space A")).toEqual([])
    expect(projection.reader.spaceSessions("Space B")).toHaveLength(1)
  })

  test("keeps mutation methods off the UI reader", () => {
    const projection = createSessionProjection()

    expect(Object.keys(projection.reader).sort()).toEqual(["getSession", "refreshKey", "sessions", "spaceSessions"])
  })

  test("indexes and retrieves sessions using normalized Windows backslash spacePath", () => {
    const projection = createSessionProjection()
    const winPath = "C:\\Users\\Sam\\Project"
    const normPath = "C:/Users/Sam/Project"

    projection.writer.upsert(serverSession({ spacePath: winPath }))

    expect(projection.reader.spaceSessions(winPath)).toHaveLength(1)
    expect(projection.reader.spaceSessions(normPath)).toHaveLength(1)
    expect(projection.reader.getSession("session-a")?.spacePath).toBe(normPath)
  })

  test("retains all sessions without truncating to 50 when count exceeds limit", () => {
    const projection = createSessionProjection()
    for (let i = 1; i <= 60; i++) {
      projection.writer.upsert(serverSession({ id: `session-${i}`, lastActiveAt: i }))
    }

    expect(projection.reader.spaceSessions("Space A")).toHaveLength(60)
  })
})
