import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import { SessionDirectoryHealth } from "./session-directory-health"
import { SpaceRegistry } from "@/wopal/space-registry"
import type { SpaceEntry } from "@/wopal/cli-schema"
import type { DirectoryHealth } from "./session-directory-health"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionGroup {
  id: string
  title: string
  type: "space" | "general"
  sessionCount: number
  sessions: SessionSummary[]
}

export interface SessionSummary {
  id: string
  title: string
  directory: string
  directoryHealth: DirectoryHealth
  agent?: string
  timeCreated: number
  timeUpdated: number
  timeArchived?: number
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface SessionProjection {
  readonly getSessionGroups: () => Effect.Effect<SessionGroup[]>
}

export class Service extends Context.Service<Service, SessionProjection>()("@opencode/SessionProjection") {}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface RawSessionRow {
  id: string
  title: string
  directory: string
  agent: string | null
  time_created: number | null
  time_updated: number | null
  time_archived: number | null
}

/** Check if a directory is under a space path. */
function isDirectoryUnderSpace(directory: string, spacePath: string): boolean {
  return directory === spacePath || directory.startsWith(spacePath + "/")
}

const make = Effect.gen(function* () {
  const health = yield* SessionDirectoryHealth.Service
  const registry = yield* SpaceRegistry.Service

  const getSessionGroups = (): Effect.Effect<SessionGroup[]> =>
    Effect.gen(function* () {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select({
              id: SessionTable.id,
              title: SessionTable.title,
              directory: SessionTable.directory,
              agent: SessionTable.agent,
              time_created: SessionTable.time_created,
              time_updated: SessionTable.time_updated,
              time_archived: SessionTable.time_archived,
            })
            .from(SessionTable)
            .all(),
        ),
      )

      // Resolve spaces from registry
      const snapshot = yield* registry.getSpaces()
      const spaces = snapshot.spaces

      // Classify each session: which space does it belong to?
      const spaceSessions = new Map<string, RawSessionRow[]>()
      const generalSessions: RawSessionRow[] = []

      for (const row of rows) {
        let matched = false
        for (const space of spaces) {
          if (isDirectoryUnderSpace(row.directory, space.path)) {
            const existing = spaceSessions.get(space.name) ?? []
            existing.push(row)
            spaceSessions.set(space.name, existing)
            matched = true
            break
          }
        }
        if (!matched) {
          generalSessions.push(row)
        }
      }

      const groups: SessionGroup[] = []

      // Build space groups (one per space that has sessions)
      for (const [spaceName, sessionRows] of spaceSessions) {
        const sessions = yield* buildSessionSummaries(sessionRows, health)
        groups.push({
          id: spaceName,
          title: spaceName,
          type: "space",
          sessionCount: sessions.length,
          sessions,
        })
      }

      // Build general groups (grouped by directory)
      if (generalSessions.length > 0) {
        const dirMap = new Map<string, RawSessionRow[]>()
        for (const row of generalSessions) {
          const existing = dirMap.get(row.directory) ?? []
          existing.push(row)
          dirMap.set(row.directory, existing)
        }

        for (const [directory, sessionRows] of dirMap) {
          const sessions = yield* buildSessionSummaries(sessionRows, health)
          groups.push({
            id: directory,
            title: directory.split("/").pop() || directory,
            type: "general",
            sessionCount: sessions.length,
            sessions,
          })
        }
      }

      return groups
    })

  return Service.of({ getSessionGroups })
})

/** Build session summaries with per-session directory health checks. */
function buildSessionSummaries(
  rows: RawSessionRow[],
  health: SessionDirectoryHealth,
): Effect.Effect<SessionSummary[]> {
  return Effect.all(
    rows.map((row) =>
      health.check(row.directory).pipe(
        Effect.map((dirHealth) => ({
          id: row.id,
          title: row.title,
          directory: row.directory,
          directoryHealth: dirHealth,
          agent: row.agent ?? undefined,
          timeCreated: row.time_created ?? 0,
          timeUpdated: row.time_updated ?? 0,
          timeArchived: row.time_archived ?? undefined,
        })),
      ),
    ),
  )
}

export const layer = Layer.effect(Service, make)

export const defaultLayer = layer.pipe(
  Layer.provide(SessionDirectoryHealth.defaultLayer),
  Layer.provide(SpaceRegistry.defaultLayer),
)

export * as SessionProjection from "./session-projection"