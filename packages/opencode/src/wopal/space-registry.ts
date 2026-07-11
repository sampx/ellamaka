import { Context, Effect, Layer, Schema } from "effect"
import { CliAdapter } from "./cli-adapter"
import type { SpaceEntry, ProjectEntry, DirectoryEntry } from "./cli-schema"
import { SpaceControlUnavailable, CapabilityContractError } from "./cli-schema"

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

export interface SpaceSnapshot {
  spaces: SpaceEntry[]
  refreshedAt: number
}

export interface ProjectSnapshot {
  items: ProjectEntry[]
  total: number
  refreshedAt: number
}

export interface DirectorySnapshot {
  items: DirectoryEntry[]
  total: number
  refreshedAt: number
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface SpaceRegistry {
  readonly refreshSpaces: (
    executablePath: string,
  ) => Effect.Effect<SpaceSnapshot, SpaceControlUnavailable | CapabilityContractError>
  readonly getSpaces: () => Effect.Effect<SpaceSnapshot>
  readonly refreshProjects: (
    executablePath: string,
  ) => Effect.Effect<ProjectSnapshot, SpaceControlUnavailable | CapabilityContractError>
  readonly searchDirectories: (
    executablePath: string,
    query: string,
  ) => Effect.Effect<DirectorySnapshot, SpaceControlUnavailable | CapabilityContractError>
}

export class Service extends Context.Service<Service, SpaceRegistry>()("@opencode/SpaceRegistry") {}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const spaceListSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      path: Schema.String,
      type: Schema.optional(Schema.String),
    }),
  ),
  total: Schema.Number,
})

const projectListSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      path: Schema.String,
    }),
  ),
  total: Schema.Number,
})

const directorySearchSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      path: Schema.String,
    }),
  ),
  total: Schema.Number,
})

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const make = Effect.gen(function* () {
  let cachedSpaces: SpaceSnapshot | null = null

  const refreshSpaces = (executablePath: string): Effect.Effect<SpaceSnapshot, SpaceControlUnavailable | CapabilityContractError> =>
    Effect.gen(function* () {
      const adapter = yield* CliAdapter.Service
      const result = yield* adapter.execute(
        executablePath,
        ["space", "list", "--json", "--api-version", "1"],
        "space.list",
        spaceListSchema,
      )
      const snapshot: SpaceSnapshot = {
        spaces: result.items as SpaceEntry[],
        refreshedAt: Date.now(),
      }
      cachedSpaces = snapshot
      return snapshot
    }) as Effect.Effect<SpaceSnapshot, SpaceControlUnavailable | CapabilityContractError>

  const getSpaces = (): Effect.Effect<SpaceSnapshot> =>
    Effect.sync(() => cachedSpaces ?? { spaces: [], refreshedAt: 0 })

  const refreshProjects = (executablePath: string): Effect.Effect<ProjectSnapshot, SpaceControlUnavailable | CapabilityContractError> =>
    Effect.gen(function* () {
      const adapter = yield* CliAdapter.Service
      const result = yield* adapter.execute(
        executablePath,
        ["space", "projects", "list", "--json", "--api-version", "1"],
        "space.projects.list",
        projectListSchema,
      )
      return {
        items: result.items as ProjectEntry[],
        total: result.total,
        refreshedAt: Date.now(),
      }
    }) as Effect.Effect<ProjectSnapshot, SpaceControlUnavailable | CapabilityContractError>

  const searchDirectories = (executablePath: string, query: string): Effect.Effect<DirectorySnapshot, SpaceControlUnavailable | CapabilityContractError> =>
    Effect.gen(function* () {
      const adapter = yield* CliAdapter.Service
      const result = yield* adapter.execute(
        executablePath,
        ["space", "directories", "search", query, "--json", "--api-version", "1"],
        "space.directories.search",
        directorySearchSchema,
      )
      return {
        items: result.items as DirectoryEntry[],
        total: result.total,
        refreshedAt: Date.now(),
      }
    }) as Effect.Effect<DirectorySnapshot, SpaceControlUnavailable | CapabilityContractError>

  return Service.of({ refreshSpaces, getSpaces, refreshProjects, searchDirectories })
})

export const layer = Layer.effect(Service, make)

export const defaultLayer = layer.pipe(Layer.provideMerge(CliAdapter.defaultLayer))

export * as SpaceRegistry from "./space-registry"
