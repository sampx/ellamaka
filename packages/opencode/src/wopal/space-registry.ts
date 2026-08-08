import { Context, Effect, Layer } from "effect"
import { CliAdapter } from "./cli-adapter"
import {
  spaceListSchema,
  spaceProjectsListSchema,
  spaceSearchSchema,
  type SpaceListData,
  type SpaceProjectsListData,
  type SpaceSearchData,
} from "./cli-schema"
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
    spaceName?: string,
  ) => Effect.Effect<ProjectSnapshot, SpaceControlUnavailable | CapabilityContractError>
  readonly searchSpace: (
    executablePath: string,
    query: string,
    spaceName?: string,
    type?: "dir" | "repo" | "file",
  ) => Effect.Effect<DirectorySnapshot, SpaceControlUnavailable | CapabilityContractError>
}

export class Service extends Context.Service<Service, SpaceRegistry>()("@opencode/SpaceRegistry") {}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const make = Effect.gen(function* () {
  const adapter = yield* CliAdapter.Service
  let cachedSpaces: SpaceSnapshot | null = null

  const refreshSpaces = (executablePath: string): Effect.Effect<SpaceSnapshot, SpaceControlUnavailable | CapabilityContractError> =>
    Effect.gen(function* () {
      const result = yield* adapter.execute<SpaceListData>(
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

  const refreshProjects = (executablePath: string, spaceName?: string): Effect.Effect<ProjectSnapshot, SpaceControlUnavailable | CapabilityContractError> =>
    Effect.gen(function* () {
      // `wopal space projects list` returns paths relative to the targeted
      // space root. Without `--space` it uses the "effective" space (detected
      // from CWD), which is wrong for a multi-space server. Always pass the
      // space name so paths are relative to a known, stable root.
      const args = spaceName
        ? ["--space", spaceName, "space", "projects", "list", "--json", "--api-version", "2"]
        : ["space", "projects", "list", "--json", "--api-version", "2"]
      const result = yield* adapter.execute<SpaceProjectsListData>(
        executablePath,
        args,
        "space.projects.list",
        spaceProjectsListSchema,
      )
      return {
        items: result.items as ProjectEntry[],
        total: result.total,
        refreshedAt: Date.now(),
      }
    }) as Effect.Effect<ProjectSnapshot, SpaceControlUnavailable | CapabilityContractError>

  const searchSpace = (
    executablePath: string,
    query: string,
    spaceName?: string,
    type?: "dir" | "repo" | "file",
  ): Effect.Effect<DirectorySnapshot, SpaceControlUnavailable | CapabilityContractError> =>
    Effect.gen(function* () {
      const baseArgs = ["space", "search", query]
      if (type) {
        baseArgs.push("--type", type)
      }
      baseArgs.push("--json", "--api-version", "1")
      const args = spaceName ? ["--space", spaceName, ...baseArgs] : baseArgs
      const result = yield* adapter.execute<SpaceSearchData>(
        executablePath,
        args,
        "space.search",
        spaceSearchSchema,
      )
      return {
        items: result.items as DirectoryEntry[],
        total: result.total,
        refreshedAt: Date.now(),
      }
    }) as Effect.Effect<DirectorySnapshot, SpaceControlUnavailable | CapabilityContractError>

  return Service.of({ refreshSpaces, getSpaces, refreshProjects, searchSpace })
})

export const layer = Layer.effect(Service, make)

export const defaultLayer = layer.pipe(Layer.provideMerge(CliAdapter.defaultLayer))

export * as SpaceRegistry from "./space-registry"
