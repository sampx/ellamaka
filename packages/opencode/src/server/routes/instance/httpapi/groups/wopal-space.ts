import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

// Mirrors the `spaces` entry in ~/.wopal/config/settings.jsonc, written by wopal-cli.
// `id` is the stable space identifier (CLI Map Key); `name` is the display name
// (may be Chinese). Aligned with the shared `SpaceEntry` v2 shape.
const WopalSpaceEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  type: Schema.optional(Schema.String),
})

const WopalSpaceList = Schema.Struct({
  spaces: Schema.Array(WopalSpaceEntry),
})

// ============ Paths ============

const Paths = {
  spaces: "/wopal-space/spaces",
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
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "wopal-space",
        description: "WopalSpace registry routes (ellamaka customization).",
      }),
    )
    .middleware(Authorization),
)

export const WopalSpaceInstanceApi = HttpApi.make("wopal-space-instance")
  .add(
    HttpApiGroup.make("wopal-space-instance")
      .add(
        HttpApiEndpoint.get("mode", "/wopal-space/mode", {
          query: WorkspaceRoutingQuery,
          success: described(
            Schema.Struct({ isWopalSpace: Schema.Boolean }),
            "WopalSpace mode for the current directory instance"
          ),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "wopal-space.mode",
            summary: "Get WopalSpace mode",
            description: "Check if the current directory instance is running in WopalSpace mode.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "wopal-space-instance",
          description: "WopalSpace instance routes (ellamaka customization).",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "wopalspace instance api",
      version: "0.0.1",
      description: "Instance-scoped WopalSpace API.",
    }),
  )

export type WopalSpaceEntry = typeof WopalSpaceEntry.Type