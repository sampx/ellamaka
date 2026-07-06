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

export type WopalSpaceEntry = typeof WopalSpaceEntry.Type