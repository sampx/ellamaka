import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
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
import path from "path"

const it = testEffect(
  SessionProjection.layer.pipe(
    Layer.provide(SessionDirectoryHealth.defaultLayer),
    Layer.provide(Layer.succeed(SpaceRegistry.Service, {
      getSpaces: () => Effect.succeed({ spaces: [], refreshedAt: 0 }),
      refreshSpaces: () => Effect.succeed({ spaces: [], refreshedAt: 0 }),
      refreshProjects: () => Effect.succeed({ items: [], total: 0, refreshedAt: 0 }),
      searchDirectories: () => Effect.succeed({ items: [], total: 0, refreshedAt: 0 }),
    })),
  ),
)

function projectionLayer(spaces: SpaceEntry[]) {
  return SessionProjection.layer.pipe(
    Layer.provide(SessionDirectoryHealth.defaultLayer),
    Layer.provide(Layer.succeed(SpaceRegistry.Service, {
      getSpaces: () => Effect.succeed({ spaces, refreshedAt: 1 }),
      refreshSpaces: () => Effect.succeed({ spaces, refreshedAt: 1 }),
      refreshProjects: () => Effect.succeed({ items: [], total: 0, refreshedAt: 0 }),
      searchDirectories: () => Effect.succeed({ items: [], total: 0, refreshedAt: 0 }),
    })),
  )
}

/** Cold-start layer: getSpaces returns empty, refreshSpaces returns the given spaces. */
function coldStartLayer(spaces: SpaceEntry[]) {
  return SessionProjection.layer.pipe(
    Layer.provide(SessionDirectoryHealth.defaultLayer),
    Layer.provide(Layer.succeed(SpaceRegistry.Service, {
      getSpaces: () => Effect.succeed({ spaces: [] as SpaceEntry[], refreshedAt: 0 }),
      refreshSpaces: () => Effect.succeed({ spaces, refreshedAt: Date.now() }),
      refreshProjects: () => Effect.succeed({ items: [], total: 0, refreshedAt: 0 }),
      searchDirectories: () => Effect.succeed({ items: [], total: 0, refreshedAt: 0 }),
    })),
  )
}

function ensureGlobalProject() {
  Database.use((db) => {
    if (db.select({ id: ProjectTable.id }).from(ProjectTable).where(eq(ProjectTable.id, ProjectID.global)).get()) return
    db.insert(ProjectTable).values({ id: ProjectID.global, worktree: "/", sandboxes: [], time_created: Date.now(), time_updated: Date.now() } as never).run()
  })
}

function insertSession(directory: string, title: string): string {
  const id = Identifier.ascending("session")
  Database.use((db) =>
    db.insert(SessionTable).values({ id: id as never, project_id: ProjectID.global, slug: Slug.create(), directory, title, version: InstallationVersion, agent: null, time_created: Date.now(), time_updated: Date.now() }).run(),
  )
  return id
}

function deleteSession(id: string) {
  Database.use((db) => db.delete(SessionTable).where(eq(SessionTable.id, id as never)).run())
}

/** Run projection query + session lifecycle in a fresh runtime with the mock. */
function queryProjection(spaces: SpaceEntry[], sessionDir: string, subDir?: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        ensureGlobalProject()
        insertSession(sessionDir, "root")
        if (subDir) insertSession(subDir, "sub")
      })
      const projection = yield* SessionProjection.Service
      const groups = yield* projection.getSessionGroups()
      return groups
    }).pipe(Effect.scoped, Effect.provide(projectionLayer(spaces))),
  )
}

/** Run projection with a cold-start registry (getSpaces returns empty, refreshSpaces provides data). */
function queryProjectionColdStart(spaces: SpaceEntry[], sessionDir: string, subDir?: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        ensureGlobalProject()
        insertSession(sessionDir, "root")
        if (subDir) insertSession(subDir, "sub")
      })
      const projection = yield* SessionProjection.Service
      const groups = yield* projection.getSessionGroups()
      return groups
    }).pipe(Effect.scoped, Effect.provide(coldStartLayer(spaces))),
  )
}

describe("session-projection-group-resolution", () => {
  it.instance("returns space group for sessions under a registered space path", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const dir = instance.directory
      const subDir = path.join(dir, "subdir")
      yield* Effect.sync(() => require("fs").mkdirSync(subDir, { recursive: true }))

      const spaces: SpaceEntry[] = [{ name: "test-space", path: dir }]
      const groups = yield* Effect.promise(() => queryProjection(spaces, dir, subDir))

      const spaceGroup = groups.find((g) => g.type === "space" && g.id === "test-space")
      expect(spaceGroup).toBeDefined()
      expect(spaceGroup!.sessions.length).toBeGreaterThanOrEqual(2)
      expect(spaceGroup!.sessions.every((s) => s.directoryHealth === "healthy")).toBe(true)
    }),
  )

  it.instance("returns general group for sessions outside any space", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const dir = instance.directory
      const generalDir = path.join(dir, "general")
      yield* Effect.sync(() => require("fs").mkdirSync(generalDir, { recursive: true }))

      const spaces: SpaceEntry[] = [{ name: "test-space", path: path.join(dir, "nonexistent") }]
      const groups = yield* Effect.promise(() => queryProjection(spaces, generalDir))

      const spaceGroup = groups.find((g) => g.type === "space")
      expect(spaceGroup).toBeUndefined()
      const generalGroup = groups.find((g) => g.type === "general")
      expect(generalGroup).toBeDefined()
      expect(generalGroup!.sessions.length).toBeGreaterThanOrEqual(1)
    }),
  )

  it.instance("retains space association for sessions with missing directory", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const dir = instance.directory
      const missingDir = path.join(dir, "missing")

      const spaces: SpaceEntry[] = [{ name: "test-space", path: missingDir }]
      const groups = yield* Effect.promise(() => queryProjection(spaces, missingDir))

      const spaceGroup = groups.find((g) => g.type === "space" && g.id === "test-space")
      expect(spaceGroup).toBeDefined()
      expect(spaceGroup!.sessions.length).toBeGreaterThanOrEqual(1)
      expect(spaceGroup!.sessions[0].directoryHealth).toBe("missing")
    }),
  )

  it.instance("cold-start: classifies space session after empty-cache refresh", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const dir = instance.directory
      const subDir = path.join(dir, "subdir")
      yield* Effect.sync(() => require("fs").mkdirSync(subDir, { recursive: true }))

      const spaces: SpaceEntry[] = [{ name: "test-space", path: dir }]
      const groups = yield* Effect.promise(() => queryProjectionColdStart(spaces, dir, subDir))

      const spaceGroup = groups.find((g) => g.type === "space" && g.id === "test-space")
      expect(spaceGroup).toBeDefined()
      expect(spaceGroup!.sessions.length).toBeGreaterThanOrEqual(2)
    }),
  )

  it.instance("cold-start: Space-root session becomes type=space with id=space.name after refresh", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const dir = instance.directory

      const spaces: SpaceEntry[] = [{ name: "my-space", path: dir }]
      const groups = yield* Effect.promise(() => queryProjectionColdStart(spaces, dir))

      const spaceGroup = groups.find((g) => g.type === "space")
      expect(spaceGroup).toBeDefined()
      expect(spaceGroup!.id).toBe("my-space")
      expect(spaceGroup!.type).toBe("space")
      expect(spaceGroup!.sessions.length).toBeGreaterThanOrEqual(1)
      expect(spaceGroup!.sessions[0].directory).toBe(dir)
    }),
  )
})