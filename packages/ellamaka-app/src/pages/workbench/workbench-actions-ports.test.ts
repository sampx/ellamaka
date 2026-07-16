import { expect, test } from "bun:test"
import { buildSessionPort, type SessionServerSDK } from "./workbench-actions-ports"
import { createSessionProjection } from "./session-store"

test("renaming a session invalidates the tree projection after the server accepts it", async () => {
  const projection = createSessionProjection()
  projection.writer.upsert({
    id: "session-1",
    spaceName: "General",
    projectPath: "",
    type: "chat",
    title: "Before",
    directoryHealth: "healthy",
    createdAt: 1,
    lastActiveAt: 1,
  })
  const updates: Array<{ sessionID: string; title: string }> = []
  const serverSDK: SessionServerSDK = {
    createClient: () => ({
      workbench: {
        createSession: async () => ({ data: { id: "unused", directory: "", timeCreated: 1, timeUpdated: 1 } }),
      },
      session: {
        get: async () => ({ data: { id: "unused", directory: "", time: { created: 1 } } }),
        update: async (input) => {
          updates.push(input)
        },
        delete: async () => {},
      },
    }),
  }
  const port = buildSessionPort(
    serverSDK,
    projection.reader,
    projection.writer,
  )

  await port.rename({
    scope: { kind: "general" },
    sessionID: "session-1",
    directory: "",
    title: "After",
  })

  expect(updates).toEqual([{ sessionID: "session-1", title: "After" }])
  expect(projection.reader.getSession("session-1")?.title).toBe("After")
  expect(projection.reader.refreshKey()).toBe(1)
})
