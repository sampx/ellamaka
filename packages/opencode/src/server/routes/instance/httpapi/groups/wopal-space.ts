import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { described } from "./metadata"

// Mirrors the `spaces` entry in ~/.wopal/config/settings.jsonc, written by wopal-cli.
const WopalSpaceEntry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  type: Schema.optional(Schema.String),
})

const WopalSpaceList = Schema.Struct({
  spaces: Schema.Array(WopalSpaceEntry),
})

// ============ Workbench grouping schemas ============

const WorkbenchSessionMarker = Schema.Union([
  Schema.Literal(""),
  Schema.Literal("directory"),
  Schema.Literal("worktree"),
])
// "" = 项目根会话; "directory" = 子目录会话; "worktree" = 工作树会话

const WorkbenchSessionSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  directory: Schema.String,
  marker: WorkbenchSessionMarker,
  agent: Schema.optional(Schema.String),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
  timeArchived: Schema.optional(Schema.Number),
})

const WorkbenchDirectoryGroup = Schema.Struct({
  path: Schema.String,
  sessionCount: Schema.Number,
  sessions: Schema.Array(WorkbenchSessionSummary),
})

const WorkbenchWorktreeGroup = Schema.Struct({
  worktreePath: Schema.String,
  branch: Schema.optional(Schema.String),
  stale: Schema.Boolean,
  sessionCount: Schema.Number,
  sessions: Schema.Array(WorkbenchSessionSummary),
})

const WorkbenchProject = Schema.Struct({
  path: Schema.String,
  displayPath: Schema.String,
  name: Schema.optional(Schema.String),
  vcs: Schema.optional(Schema.Literal("git")),
  sessionCount: Schema.Number,
  rootSessions: Schema.Array(WorkbenchSessionSummary),
  directories: Schema.Array(WorkbenchDirectoryGroup),
  worktrees: Schema.Array(WorkbenchWorktreeGroup),
})

const WorkbenchSpaceOverviewResponse = Schema.Struct({
  spaceName: Schema.String,
  spacePath: Schema.String,
  spaceRootSessionCount: Schema.Number,
  spaceRootSessions: Schema.Array(WorkbenchSessionSummary),
  projects: Schema.Array(WorkbenchProject),
})

const WorkbenchNonSpaceOverviewResponse = Schema.Struct({
  orphanDirectories: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      sessionCount: Schema.Number,
      sessions: Schema.Array(WorkbenchSessionSummary),
    }),
  ),
})

const WorkbenchSearchDirectory = Schema.Struct({
  path: Schema.String,
  displayPath: Schema.String,
  isGitRepo: Schema.Boolean,
})

const WorkbenchSearchDirectoriesResponse = Schema.Struct({
  directories: Schema.Array(WorkbenchSearchDirectory),
})

const WorkbenchRecentDirectoriesResponse = Schema.Struct({
  directories: Schema.Array(WorkbenchSearchDirectory),
})

// ============ Query schemas ============

const SpaceOverviewQuery = Schema.Struct({
  spaceName: Schema.String,
})

const SearchDirectoriesQuery = Schema.Struct({
  spaceName: Schema.String,
  query: Schema.String,
})

const RecentDirectoriesQuery = Schema.Struct({
  spaceName: Schema.String,
})

const EnsureDirectoryPayload = Schema.Struct({
  path: Schema.String,
})

const EnsureDirectoryResponse = Schema.Struct({
  created: Schema.Boolean,
})

// ============ Paths ============

const Paths = {
  spaces: "/wopal-space/spaces",
  spaceOverview: "/wopal-space/space-overview",
  nonSpaceOverview: "/wopal-space/non-space-overview",
  searchDirectories: "/wopal-space/search-directories",
  recentDirectories: "/wopal-space/recent-directories",
  ensureDirectory: "/wopal-space/ensure-directory",
} as const

export const WopalSpaceApi = HttpApi.make("wopal-space").add(
  HttpApiGroup.make("wopal-space")
    .add(
      HttpApiEndpoint.get("spaces", Paths.spaces, {
        success: described(WopalSpaceList, "Registered WopalSpace spaces"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "wopal-space.spaces",
          summary: "List WopalSpace spaces",
          description:
            "Read the `spaces` registry from ~/.wopal/config/settings.jsonc (managed by wopal-cli). Returns all registered WopalSpace spaces with name, path, and type.",
        }),
      ),
      HttpApiEndpoint.get("spaceOverview", Paths.spaceOverview, {
        query: SpaceOverviewQuery,
        success: described(WorkbenchSpaceOverviewResponse, "Space overview with grouped sessions"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "wopal-space.spaceOverview",
          summary: "Get space overview",
          description:
            "Return the complete Workbench grouping structure for a space: projects with root sessions, subdirectory groups, and worktree groups, plus space-root sessions.",
        }),
      ),
      HttpApiEndpoint.get("nonSpaceOverview", Paths.nonSpaceOverview, {
        success: described(WorkbenchNonSpaceOverviewResponse, "Non-space sessions grouped by directory"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "wopal-space.nonSpaceOverview",
          summary: "Get non-space overview",
          description:
            "Return sessions that do not belong to any registered WopalSpace, grouped by directory.",
        }),
      ),
      HttpApiEndpoint.get("searchDirectories", Paths.searchDirectories, {
        query: SearchDirectoriesQuery,
        success: described(WorkbenchSearchDirectoriesResponse, "Matching directories in the space"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "wopal-space.searchDirectories",
          summary: "Search directories in a space",
          description:
            "Fuzzy-match subdirectories within a space by name. Returns up to 50 results with git-repo detection.",
        }),
      ),
      HttpApiEndpoint.get("recentDirectories", Paths.recentDirectories, {
        query: RecentDirectoriesQuery,
        success: described(WorkbenchRecentDirectoriesResponse, "Recently used directories in the space"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "wopal-space.recentDirectories",
          summary: "Get recent directories",
          description:
            "Return directories within a space that have had recent sessions, ordered by most recent first (up to 20).",
        }),
      ),
      HttpApiEndpoint.post("ensureDirectory", Paths.ensureDirectory, {
        payload: EnsureDirectoryPayload,
        success: described(EnsureDirectoryResponse, "Directory creation result"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "wopal-space.ensureDirectory",
          summary: "Ensure directory exists",
          description: "Create a directory (recursively) if it does not already exist.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "wopal-space",
        description: "WopalSpace registry and Workbench grouping routes (ellamaka customization).",
      }),
    )
    .middleware(Authorization),
)

export type WopalSpaceEntry = typeof WopalSpaceEntry.Type
