import { Schema } from "effect"
import { Type, type Static } from "@sinclair/typebox"
import {
  spaceListSchema,
  spaceListItemSchema,
  spaceProjectsListSchema,
  spaceProjectItemSchema,
  spaceProjectWorktreeSchema,
  spaceSearchSchema,
  spaceSearchItemSchema,
  type SpaceListData,
  type SpaceProjectsListData,
  type SpaceSearchData,
} from "@wopal/capability-schema"

// ---------------------------------------------------------------------------
// CLI envelope (wopal.capability/v1)
// ---------------------------------------------------------------------------

export const CliEnvelopeSuccess = Type.Object({
  apiVersion: Type.String(),
  capability: Type.String(),
  ok: Type.Literal(true),
  data: Type.Unknown(),
})

export const CliEnvelopeError = Type.Object({
  apiVersion: Type.String(),
  capability: Type.String(),
  ok: Type.Literal(false),
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    suggestion: Type.Optional(Type.String()),
  }),
})

export const CliEnvelope = Type.Union([CliEnvelopeSuccess, CliEnvelopeError])

export type CliEnvelopeSuccess = Static<typeof CliEnvelopeSuccess>
export type CliEnvelopeError = Static<typeof CliEnvelopeError>

// ---------------------------------------------------------------------------
// Capability data schemas — imported from the shared contract package
// (@wopal/capability-schema), the same TypeBox schemas wopal-cli generates
// its registry from. Compile-time sync: a new required field in wopal-cli
// surfaces here at build time, not at runtime.
// ---------------------------------------------------------------------------

export {
  spaceListSchema,
  spaceListItemSchema,
  spaceProjectsListSchema,
  spaceProjectItemSchema,
  spaceProjectWorktreeSchema,
  spaceSearchSchema,
  spaceSearchItemSchema,
  type SpaceListData,
  type SpaceProjectsListData,
  type SpaceSearchData,
}

export type SpaceEntry = Static<typeof spaceListItemSchema>
export type ProjectEntry = Static<typeof spaceProjectItemSchema>
export type DirectoryEntry = Static<typeof spaceSearchItemSchema>

// ---------------------------------------------------------------------------
// Runtime domain errors (adapter boundary)
// ---------------------------------------------------------------------------

export class SpaceControlUnavailable extends Schema.TaggedErrorClass<SpaceControlUnavailable>()(
  "SpaceControlUnavailable",
  {
    message: Schema.String,
    reason: Schema.optional(Schema.String),
  },
) {
  get httpStatus() {
    return 503 as const
  }
}

export class CapabilityContractError extends Schema.TaggedErrorClass<CapabilityContractError>()(
  "CapabilityContractError",
  {
    message: Schema.String,
    capability: Schema.optional(Schema.String),
    detail: Schema.optional(Schema.String),
  },
) {
  get httpStatus() {
    return 502 as const
  }
}

// ---------------------------------------------------------------------------
// Stable error codes the adapter maps from CLI envelope error.code
// ---------------------------------------------------------------------------

export const StableErrorCode = Type.Union([
  Type.Literal("SPACE_NOT_FOUND"),
  Type.Literal("NO_EFFECTIVE_SPACE"),
  Type.Literal("PATH_TRAVERSAL_DETECTED"),
  Type.Literal("CAPABILITY_VERSION_UNSUPPORTED"),
  Type.Literal("UNKNOWN_ERROR"),
])

export type StableErrorCode = Static<typeof StableErrorCode>

// ---------------------------------------------------------------------------
// Self-reexport
// ---------------------------------------------------------------------------

export * as CliSchema from "./cli-schema"
