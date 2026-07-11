import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { SessionProjection } from "../../src/workbench/session-projection"
import { SessionDirectoryHealth } from "../../src/workbench/session-directory-health"
import { SpaceRegistry } from "../../src/wopal/space-registry"
import { Database } from "../../src/storage/db"
import { SessionTable } from "../../src/session/session.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Identifier } from "../../src/id/id"
import { Slug } from "@opencode-ai/core/util/slug"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import type { SpaceEntry } from "../../src/wopal/cli-schema"
import { eq } from "drizzle-orm"
import os from "os"
import path from "path"
import fs from "fs"

/** Build a test layer with the given mock spaces. */
function projectionLayer(spaces: SpaceEntry[]) {
  return SessionProjection.layer.pipe(
    Layer.provide(SessionDirectoryHealth.defaultLayer),
    Layer.provide(
      Layer.succeed(SpaceRegistry.Service, {
        getSpaces: () => Effect.succeed({ spaces, refreshedAt: 1 }),
        refreshSpaces: () => Effect.succeed({ spaces, refreshedAt: 1 }),
        refreshProjects: () => Effect.succeed({ items: [], total: 0, refreshedAt: 0 }),
        searchDirectories: () => Effect.succeed({ items: [], total: 0, refreshedAt: 0 }),
      }),
    ),
  )
}

describe("session-projection-group-resolution", () => {
  it("returns space group for sessions under a registered space path", async () => {
    const spaceDir = path.join(os.tmpdir(), "opencode-test-space-" + Math.random().toString(36).slice(2))
    const subDir = path.join(spaceDir, "subdir")
    fs.mkdirSync(subDir, { recursive: true })

    const spaces: SpaceEntry[] = [{ name: "test-space", path: spaceDir }]

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        let rootId = ""
        let subId = ""
        yield* Effect.sync(() => {
          Database.use((db) => {
            const existing = db.select({ id: ProjectTable.id }).from(ProjectTable).where(eq(ProjectTable.id, ProjectID.global)).get()
            if (!existing) db.insert(ProjectTable).values({ id: ProjectID.global, worktree: "/", sandboxes: [], time_created: Date.now(), time_updated: Date.now() } as any).run()
            rootId = Identifier.ascending("session")
            subId = Identifier.ascending("session")
            db.insert(SessionTable).values({ id: rootId as any, project_id: ProjectID.global, slug: Slug.create(), directory: spaceDir, title: "root", version: InstallationVersion, agent: null, time_created: Date.now(), time_updated: Date.now() }).run()
            db.insert(SessionTable).values({ id: subId as any, project_id: ProjectID.global, slug: Slug.create(), directory: subDir, title: "sub", version: InstallationVersion, agent: null, time_created: Date.now(), time_updated: Date.now() }).run()
          })
        })

        const projection = yield* SessionProjection.Service
        const groups = yield* projection.getSessionGroups()

        yield* Effect.sync(() => {
          Database.use((db) => {
            db.delete(SessionTable).where(eq(SessionTable.id, rootId as any)).run()
            db.delete(SessionTable).where(eq(SessionTable.id, subId as any)).run()
          })
        })

        return { groups, rootId, subId }
      }).pipe(Effect.scoped, Effect.provide(projectionLayer(spaces))),
    )

    const spaceGroup = result.groups.find((g) => g.type === "space" && g.id === "test-space")
    expect(spaceGroup).toBeDefined()
    const sessionIds = new Set(spaceGroup!.sessions.map((s) => s.id))
    expect(sessionIds.has(result.rootId)).toBe(true)
    expect(sessionIds.has(result.subId)).toBe(true)
    expect(spaceGroup!.sessions.every((s) => s.directoryHealth === "healthy")).toBe(true)

    fs.rmSync(spaceDir, { recursive: true, force: true })
  })

  it("returns general group for sessions outside any space", async () => {
    const generalDir = path.join(os.tmpdir(), "opencode-test-general-" + Math.random().toString(36).slice(2))
    fs.mkdirSync(generalDir, { recursive: true })

    const spaces: SpaceEntry[] = [{ name: "test-space", path: "/tmp/some-other-space" }]

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        let sessionId = ""
        yield* Effect.sync(() => {
          Database.use((db) => {
            const existing = db.select({ id: ProjectTable.id }).from(ProjectTable).where(eq(ProjectTable.id, ProjectID.global)).get()
            if (!existing) db.insert(ProjectTable).values({ id: ProjectID.global, worktree: "/", sandboxes: [], time_created: Date.now(), time_updated: Date.now() } as any).run()
            sessionId = Identifier.ascending("session")
            db.insert(SessionTable).values({ id: sessionId as any, project_id: ProjectID.global, slug: Slug.create(), directory: generalDir, title: "gen", version: InstallationVersion, agent: null, time_created: Date.now(), time_updated: Date.now() }).run()
          })
        })

        const projection = yield* SessionProjection.Service
        const groups = yield* projection.getSessionGroups()

        yield* Effect.sync(() => {
          Database.use((db) => db.delete(SessionTable).where(eq(SessionTable.id, sessionId as any)).run())
        })

        return { groups, sessionId }
      }).pipe(Effect.scoped, Effect.provide(projectionLayer(spaces))),
    )

    const spaceGroup = result.groups.find((g) => g.type === "space")
    expect(spaceGroup).toBeUndefined()

    const generalGroup = result.groups.find((g) => g.type === "general")
    expect(generalGroup).toBeDefined()
    const sessionIds = new Set(generalGroup!.sessions.map((s) => s.id))
    expect(sessionIds.has(result.sessionId)).toBe(true)

    fs.rmSync(generalDir, { recursive: true, force: true })
  })

  it("retains space association for sessions with missing directory", async () => {
    const missingDir = path.join(os.tmpdir(), "opencode-test-missing-" + Math.random().toString(36).slice(2))
    // Do NOT create the directory — it should be missing

    const spaces: SpaceEntry[] = [{ name: "test-space", path: missingDir }]

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        let sessionId = ""
        yield* Effect.sync(() => {
          Database.use((db) => {
            const existing = db.select({ id: ProjectTable.id }).from(ProjectTable).where(eq(ProjectTable.id, ProjectID.global)).get()
            if (!existing) db.insert(ProjectTable).values({ id: ProjectID.global, worktree: "/", sandboxes: [], time_created: Date.now(), time_updated: Date.now() } as any).run()
            sessionId = Identifier.ascending("session")
            db.insert(SessionTable).values({ id: sessionId as any, project_id: ProjectID.global, slug: Slug.create(), directory: missingDir, title: "missing", version: InstallationVersion, agent: null, time_created: Date.now(), time_updated: Date.now() }).run()
          })
        })

        const projection = yield* SessionProjection.Service
        const groups = yield* projection.getSessionGroups()

        yield* Effect.sync(() => {
          Database.use((db) => db.delete(SessionTable).where(eq(SessionTable.id, sessionId as any)).run())
        })

        return { groups, sessionId }
      }).pipe(Effect.scoped, Effect.provide(projectionLayer(spaces))),
    )

    const spaceGroup = result.groups.find((g) => g.type === "space" && g.id === "test-space")
    expect(spaceGroup).toBeDefined()
    const sessionIds = new Set(spaceGroup!.sessions.map((s) => s.id))
    expect(sessionIds.has(result.sessionId)).toBe(true)
    const session = spaceGroup!.sessions.find((s) => s.id === result.sessionId)!
    expect(session.directoryHealth).toBe("missing")
  })
})