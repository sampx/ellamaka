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

test("creates a Space session with a request ID and canonical relative directory", async () => {
  const projection = createSessionProjection()
  const requests: unknown[] = []
  const serverSDK: SessionServerSDK = {
    createClient: () => ({
      workbench: {
        createSession: async (input) => {
          requests.push(input)
          return { data: { id: "session-created", directory: "/fixtures/space-a/project", timeCreated: 1, timeUpdated: 1 } }
        },
      },
      session: {
        get: async () => ({ data: { id: "unused", directory: "", time: { created: 1 } } }),
        update: async () => {},
        delete: async () => {},
      },
    }),
  }
  const port = buildSessionPort(serverSDK, projection.reader, projection.writer)

  const session = await port.create({
    scope: { kind: "space", name: "Same name", path: "/fixtures/space-a" },
    panel: {
      id: "p-1",
      slotState: "empty",
      mode: "",
      directory: "/fixtures/space-a/project",
      width: 1,
    },
    initialView: "tui",
  })

  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({
    requestID: expect.any(String),
    target: { type: "space", spacePath: "/fixtures/space-a", directory: "project" },
  })
  expect(session.type).toBe("tui")
})
