import { Context, Effect, Layer, Schema } from "effect"
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
      // In production, this would query the database.
      // For now, return empty groups as a placeholder.
      return [] as SessionGroup[]
    })

  return Service.of({ getSessionGroups })
})

export const layer = Layer.effect(Service, make)

export const defaultLayer = layer.pipe(Layer.provide(SessionDirectoryHealth.defaultLayer))

export * as SessionProjection from "./session-projection"