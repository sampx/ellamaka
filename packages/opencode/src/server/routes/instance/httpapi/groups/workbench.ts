import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { described } from "./metadata"

// ============ Request schemas ============

const GeneralTarget = Schema.Struct({
  type: Schema.Literal("general"),
})

const SpaceTarget = Schema.Struct({
  type: Schema.Literal("space"),
  space: Schema.String,
  directory: Schema.optional(Schema.String),
})

const CreateSessionPayload = Schema.Struct({
  target: Schema.Union([GeneralTarget, SpaceTarget]),
  title: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
})

// ============ Response schemas ============

const DirectoryHealth = Schema.Literals(["healthy", "missing", "unavailable"])

const WorkbenchSessionResponse = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  directory: Schema.String,
  directoryHealth: DirectoryHealth,
  agent: Schema.optional(Schema.String),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
})

const SessionGroupType = Schema.Literals(["space", "general"])

const WorkbenchSessionGroup = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  type: SessionGroupType,
  sessionCount: Schema.Number,
  sessions: Schema.Array(WorkbenchSessionResponse),
})

const WorkbenchSessionGroupsResponse = Schema.Struct({
  groups: Schema.Array(WorkbenchSessionGroup),
})

// ============ Paths ============

const Paths = {
  sessions: "/workbench/sessions",
  sessionGroups: "/workbench/session-groups",
} as const

// ============ API ============

export const WorkbenchApi = HttpApi.make("workbench").add(
  HttpApiGroup.make("workbench")
    .add(
      HttpApiEndpoint.post("createSession", Paths.sessions, {
        payload: CreateSessionPayload,
        success: described(WorkbenchSessionResponse, "Created session with directory health"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "workbench.createSession",
          summary: "Create a Workbench session",
          description:
            "Create a controlled session. For `general` target, the backend provisions a directory under `$WOPAL_HOME/general_tasks/`. For `space` target, the specified space must be registered and the directory must exist within the space.",
        }),
      ),
      HttpApiEndpoint.get("sessionGroups", Paths.sessionGroups, {
        success: described(WorkbenchSessionGroupsResponse, "Session groups with directory health"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "workbench.sessionGroups",
          summary: "List Workbench session groups",
          description:
            "Return all sessions grouped by space or general, with directory health per session. Sessions from external TUI are included in the projection.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "workbench",
        description: "Workbench session creation and projection routes (ellamaka customization).",
      }),
    )
    .middleware(Authorization),
)