import { existsSync, mkdirSync } from "fs"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { InvalidRequestError } from "../errors"
import { SpaceRegistry } from "@/wopal/space-registry"
import { realpathSafe, groupSessionsBySpace } from "./wopal-space-grouping"
import { Database } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import { ProjectTable } from "@/project/project.sql"
import type { Session } from "@/session/session"
import type { Project } from "@/project/project"
import type { SpaceEntry } from "@/wopal/cli-schema"

// ---------------------------------------------------------------------------
// Database queries (kept for session/project grouping, not space registry)
// ---------------------------------------------------------------------------

function queryAllSessions(): Session.Info[] {
  return Database.use((db) =>
    db
      .select({
        id: SessionTable.id,
        title: SessionTable.title,
        directory: SessionTable.directory,
        agent: SessionTable.agent,
        projectID: SessionTable.project_id,
        time_created: SessionTable.time_created,
        time_updated: SessionTable.time_updated,
        time_archived: SessionTable.time_archived,
      })
      .from(SessionTable)
      .all(),
  ).map((row) => ({
    id: row.id,
    title: row.title,
    directory: row.directory,
    agent: row.agent ?? undefined,
    projectID: row.projectID,
    slug: "",
    version: "",
    time: {
      created: row.time_created ?? 0,
      updated: row.time_updated ?? 0,
      archived: row.time_archived ?? undefined,
    },
  })) as Session.Info[]
}

function queryAllProjects(): Project.Info[] {
  return Database.use((db) =>
    db
      .select({
        id: ProjectTable.id,
        worktree: ProjectTable.worktree,
        name: ProjectTable.name,
        vcs: ProjectTable.vcs,
      })
      .from(ProjectTable)
      .all(),
  ).map((row) => ({
    id: row.id,
    worktree: row.worktree,
    name: row.name ?? undefined,
    vcs: row.vcs as "git" | undefined,
    sandboxes: [],
    time: { created: 0, updated: 0 },
  })) as Project.Info[]
}

// ---------------------------------------------------------------------------
// Space list helper
// ---------------------------------------------------------------------------

const WOPAL_CLI = "/Users/sam/.wopal/bin/wopal"

const resolveSpaces = (registry: SpaceRegistry) =>
  Effect.gen(function* () {
    const snapshot = yield* registry.getSpaces()
    if (snapshot.spaces.length > 0) return snapshot.spaces
    const refreshed = yield* registry.refreshSpaces(WOPAL_CLI)
    return refreshed.spaces
  }).pipe(Effect.catch(() => Effect.succeed([] as SpaceEntry[])))

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const wopalSpaceHandlers = HttpApiBuilder.group(RootHttpApi, "wopal-space", (handlers) =>
  Effect.gen(function* () {
    const registry = yield* SpaceRegistry.Service

    const spaces = Effect.fn("WopalSpaceHttpApi.spaces")(function* () {
      const list = yield* resolveSpaces(registry)
      return { spaces: list }
    })

    const spaceOverview = Effect.fn("WopalSpaceHttpApi.spaceOverview")(function* (ctx: {
      query: { spaceName: string }
    }) {
      const list = yield* resolveSpaces(registry)
      const entry = list.find((s: SpaceEntry) => s.name === ctx.query.spaceName)
      if (!entry) return yield* new InvalidRequestError({ message: "Space not found: " + ctx.query.spaceName })
      const spaceRealPath = realpathSafe(entry.path)
      const sessions = queryAllSessions()
      const projects = queryAllProjects()
      const { projects: groupedProjects, spaceRootSessions } = groupSessionsBySpace(
        spaceRealPath,
        sessions,
        projects,
      )
      return {
        spaceName: ctx.query.spaceName,
        spacePath: entry.path,
        spaceRootSessionCount: spaceRootSessions.length,
        spaceRootSessions,
        projects: groupedProjects,
      }
    })

    const nonSpaceOverview = Effect.fn("WopalSpaceHttpApi.nonSpaceOverview")(function* () {
      const list = yield* resolveSpaces(registry)
      const spaceRealPaths = new Set(list.map((s: SpaceEntry) => realpathSafe(s.path)))
      const sessions = queryAllSessions()
      const active = sessions.filter((s) => s.time.archived == null)
      const orphan = active.filter((s) => {
        for (const sp of spaceRealPaths) {
          if (s.directory === sp || s.directory.startsWith(sp + "/")) return false
        }
        return true
      })
      const dirMap = new Map<string, typeof orphan>()
      for (const s of orphan) {
        const existing = dirMap.get(s.directory) || []
        existing.push(s)
        dirMap.set(s.directory, existing)
      }
      const orphanDirectories = [...dirMap.entries()].map(([p, s]) => ({
        path: p,
        sessionCount: s.length,
        sessions: s.map((s) => ({
          id: s.id,
          title: s.title,
          directory: s.directory,
          marker: "" as const,
          agent: s.agent,
          timeCreated: s.time.created,
          timeUpdated: s.time.updated,
          timeArchived: s.time.archived,
        })),
      }))
      return { orphanDirectories }
    })

    const searchDirectories = Effect.fn("WopalSpaceHttpApi.searchDirectories")(function* (ctx: {
      query: { spaceName: string; query: string }
    }) {
      const list = yield* resolveSpaces(registry)
      const entry = list.find((s: SpaceEntry) => s.name === ctx.query.spaceName)
      if (!entry) return yield* new InvalidRequestError({ message: "Space not found: " + ctx.query.spaceName })
      if (!ctx.query.query) return { directories: [] }
      const result = yield* registry.searchDirectories(WOPAL_CLI, ctx.query.query).pipe(
        Effect.catch(() => Effect.succeed({ items: [], total: 0, refreshedAt: 0 })),
      )
      const directories = result.items.slice(0, 50).map((d) => ({
        path: d.path,
        displayPath: d.path,
        isGitRepo: false,
      }))
      return { directories }
    })

    const recentDirectories = Effect.fn("WopalSpaceHttpApi.recentDirectories")(function* (ctx: {
      query: { spaceName: string }
    }) {
      const list = yield* resolveSpaces(registry)
      const entry = list.find((s: SpaceEntry) => s.name === ctx.query.spaceName)
      if (!entry) return yield* new InvalidRequestError({ message: "Space not found: " + ctx.query.spaceName })
      const spaceRealPath = realpathSafe(entry.path)
      const sessions = queryAllSessions()
      const active = sessions.filter(
        (s) =>
          s.time.archived == null &&
          (s.directory === spaceRealPath || s.directory.startsWith(spaceRealPath + "/")),
      )
      const dirLatest = new Map<string, number>()
      for (const s of active) {
        const prev = dirLatest.get(s.directory)
        if (prev === undefined || s.time.created > prev) {
          dirLatest.set(s.directory, s.time.created)
        }
      }
      const sorted = [...dirLatest.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
      const directories = sorted.map(([p]) => ({
        path: p,
        displayPath: p,
        isGitRepo: false,
      }))
      return { directories }
    })

    const ensureDirectory = Effect.fn("WopalSpaceHttpApi.ensureDirectory")(function* (ctx: {
      payload: { path: string }
    }) {
      const dir = ctx.payload.path
      try {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true })
          return { created: true }
        }
        return { created: false }
      } catch {
        return yield* new InvalidRequestError({ message: "Failed to create directory: " + dir })
      }
    })

    return handlers
      .handle("spaces", spaces)
      .handle("spaceOverview", spaceOverview)
      .handle("nonSpaceOverview", nonSpaceOverview)
      .handle("searchDirectories", searchDirectories)
      .handle("recentDirectories", recentDirectories)
      .handle("ensureDirectory", ensureDirectory)
  }),
)