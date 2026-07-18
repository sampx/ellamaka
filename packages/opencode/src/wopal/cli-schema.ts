import { Schema } from "effect"

// ---------------------------------------------------------------------------
// CLI envelope (wopal.capability/v1)
// ---------------------------------------------------------------------------

export const CliEnvelopeSuccess = Schema.Struct({
  apiVersion: Schema.String,
  capability: Schema.String,
  ok: Schema.Literal(true),
  data: Schema.Any,
})

export const CliEnvelopeError = Schema.Struct({
  apiVersion: Schema.String,
  capability: Schema.String,
  ok: Schema.Literal(false),
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
    suggestion: Schema.optional(Schema.String),
  }),
})

export const CliEnvelope = Schema.Union([CliEnvelopeSuccess, CliEnvelopeError])

export type CliEnvelopeSuccess = Schema.Schema.Type<typeof CliEnvelopeSuccess>
export type CliEnvelopeError = Schema.Schema.Type<typeof CliEnvelopeError>

// ---------------------------------------------------------------------------
// Capability data schemas
// ---------------------------------------------------------------------------

export const SpaceEntry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  type: Schema.optional(Schema.String),
})

export const SpaceListData = Schema.Struct({
  items: Schema.Array(SpaceEntry),
  total: Schema.Number,
})

export const ProjectEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  worktrees: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        branch: Schema.optional(Schema.String),
      }),
    ),
  ),
})

export const ProjectListData = Schema.Struct({
  items: Schema.Array(ProjectEntry),
  total: Schema.Number,
})

export const DirectoryEntry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  type: Schema.optional(Schema.Literals(["dir", "repo", "file"])),
})

export const DirectorySearchData = Schema.Struct({
  items: Schema.Array(DirectoryEntry),
  total: Schema.Number,
})

export type SpaceEntry = Schema.Schema.Type<typeof SpaceEntry>
export type ProjectEntry = Schema.Schema.Type<typeof ProjectEntry>
export type DirectoryEntry = Schema.Schema.Type<typeof DirectoryEntry>

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

export const StableErrorCode = Schema.Literals([
  "SPACE_NOT_FOUND",
  "NO_EFFECTIVE_SPACE",
  "PATH_TRAVERSAL_DETECTED",
  "CAPABILITY_VERSION_UNSUPPORTED",
  "UNKNOWN_ERROR",
])

export type StableErrorCode = Schema.Schema.Type<typeof StableErrorCode>

// ---------------------------------------------------------------------------
// Self-reexport
// ---------------------------------------------------------------------------

export * as CliSchema from "./cli-schema"