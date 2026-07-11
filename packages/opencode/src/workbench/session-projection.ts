import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import { SessionDirectoryHealth } from "./session-directory-health"
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

const make = Effect.gen(function* () {
  const health = yield* SessionDirectoryHealth.Service

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

      // Group sessions by directory — each unique directory becomes a group
      const dirMap = new Map<string, RawSessionRow[]>()
      for (const row of rows) {
        const existing = dirMap.get(row.directory) || []
        existing.push(row)
        dirMap.set(row.directory, existing)
      }

      const groups: SessionGroup[] = yield* Effect.all(
        [...dirMap.entries()].map(([directory, sessionRows]) =>
          Effect.gen(function* () {
            const dirHealth = yield* health.check(directory)
            const sessions: SessionSummary[] = sessionRows.map((row) => ({
              id: row.id,
              title: row.title,
              directory: row.directory,
              directoryHealth: dirHealth,
              agent: row.agent ?? undefined,
              timeCreated: row.time_created ?? 0,
              timeUpdated: row.time_updated ?? 0,
              timeArchived: row.time_archived ?? undefined,
            }))

            // Determine group type: check if directory is under any known space
            // For now, all groups are marked as "general" — space-aware grouping
            // is handled by the frontend matching groups to space paths
            return {
              id: directory,
              title: directory.split("/").pop() || directory,
              type: "general" as const,
              sessionCount: sessions.length,
              sessions,
            }
          }),
        ),
      )

      return groups
    })

  return Service.of({ getSessionGroups })
})

export const layer = Layer.effect(Service, make)

export const defaultLayer = layer.pipe(Layer.provide(SessionDirectoryHealth.defaultLayer))

export * as SessionProjection from "./session-projection"