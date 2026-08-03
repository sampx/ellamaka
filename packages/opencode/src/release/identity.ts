// packages/opencode/src/release/identity.ts
//
// TypeScript runtime twin of scripts/release-identity.mjs. Provides the
// parser/validator consumed by the CLI `debug release-info` machine command
// and (via build-time define) by the embedded identity surface.
//
// The semantics MUST stay in sync with scripts/release-identity.mjs. The mjs
// module is the build-time source; this TS module is the runtime source.

const PRODUCTS = ["ellamaka-cli", "ellamaka-desktop"] as const
type Product = (typeof PRODUCTS)[number]

const RELEASE_CHANNELS = ["stable", "beta", "rc"] as const
const DEV_CHANNELS = ["local", "main"] as const
const COMMIT_RE = /^[0-9a-f]{40}$/
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SEMVER_BETA_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/
const SEMVER_RC_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.(0|[1-9]\d*)$/

export class ReleaseIdentityError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = "ReleaseIdentityError"
    this.code = code
  }
}

export type Prerelease = { kind: "beta"; n: number } | { kind: "rc"; n: number }

export type Upstream = {
  name: "opencode"
  version: string
  gitCommit: string
}

export type ReleaseBuild = {
  sourceTag: string
  gitCommit: string
  builtAt: string
  workflowRunId: string
}

export type DevBuild = {
  gitCommit?: string
  builtAt?: string
}

export type ReleaseIdentity =
  | {
      schemaVersion: 2
      kind: "release"
      product: Product
      version: string
      channel: (typeof RELEASE_CHANNELS)[number]
      upstream: Upstream
      build: ReleaseBuild
    }
  | {
      schemaVersion: 2
      kind: "development"
      product: Product
      version: string
      channel: (typeof DEV_CHANNELS)[number]
      build: DevBuild
    }

export type RawIdentity = Record<string, unknown>

function fail(code: string, message: string): never {
  throw new ReleaseIdentityError(code, message)
}

function isProduct(x: unknown): x is Product {
  return typeof x === "string" && (PRODUCTS as readonly string[]).includes(x)
}

function isReleaseChannel(x: unknown): x is (typeof RELEASE_CHANNELS)[number] {
  return typeof x === "string" && (RELEASE_CHANNELS as readonly string[]).includes(x)
}

function isDevChannel(x: unknown): x is (typeof DEV_CHANNELS)[number] {
  return typeof x === "string" && (DEV_CHANNELS as readonly string[]).includes(x)
}

function assertNoExtra(obj: Record<string, unknown>, allowed: Set<string>, where: string) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) fail("ESCHEMA", `unexpected field ${where}.${key}`)
  }
}

/**
 * Parse and validate a ReleaseIdentity object (release or development kind).
 * Enforces required/forbidden fields per kind. Throws ReleaseIdentityError
 * on any violation.
 */
export function parseReleaseIdentity(input: RawIdentity): ReleaseIdentity {
  if (!input || typeof input !== "object") fail("EINVAL", "identity must be an object")
  if (input.schemaVersion !== 2) fail("ESCHEMA", `schemaVersion must be 2`)
  if (!isProduct(input.product)) fail("EPRODUCT", `unknown product ${String(input.product)}`)
  if (typeof input.version !== "string") fail("EINVAL", "version must be a string")
  if (input.version.includes("+")) {
    fail("EBUILD", `version ${input.version} contains +build metadata, which is forbidden`)
  }

  if (input.kind === "release") return parseReleaseKind(input as Record<string, unknown>)
  if (input.kind === "development") return parseDevelopmentKind(input as Record<string, unknown>)
  fail("EKIND", `unknown kind ${String(input.kind)}; expected release|development`)
}

function parseReleaseKind(input: Record<string, unknown>): ReleaseIdentity {
  const channel = input.channel
  if (!isReleaseChannel(channel)) {
    fail("ECHANNEL", `release identity channel ${String(channel)} is not a release channel`)
  }
  assertChannelVersionConsistent(channel, input.version as string)

  const b = (input.build ?? {}) as Record<string, unknown>
  const allowedBuild = new Set(["sourceTag", "gitCommit", "builtAt", "workflowRunId"])
  assertNoExtra(b, allowedBuild, "build")
  if (typeof b.sourceTag !== "string" || !b.sourceTag) {
    fail("ESOURCETAG", `release identity build.sourceTag is required`)
  }
  if (typeof b.gitCommit !== "string" || !COMMIT_RE.test(b.gitCommit)) {
    fail("ECOMMIT", `release identity build.gitCommit is not a 40-char SHA`)
  }
  if (typeof b.builtAt !== "string" || !ISO8601_RE.test(b.builtAt)) {
    fail("ETIME", `release identity build.builtAt is not ISO-8601 UTC`)
  }
  if (b.workflowRunId === undefined || b.workflowRunId === null || b.workflowRunId === "") {
    fail("ERUN", `release identity build.workflowRunId is required`)
  }

  const upstream = (input.upstream ?? {}) as Record<string, unknown>
  if (upstream.name !== "opencode") fail("EUPSTREAM", `upstream.name must be opencode`)
  if (typeof upstream.version !== "string" || !SEMVER_RE.test(upstream.version)) {
    fail("EVERSION", `upstream.version is not stable SemVer`)
  }
  if (typeof upstream.gitCommit !== "string" || !COMMIT_RE.test(upstream.gitCommit)) {
    fail("ECOMMIT", `upstream.gitCommit is not a 40-char SHA`)
  }

  return {
    schemaVersion: 2,
    kind: "release",
    product: input.product as Product,
    version: input.version as string,
    channel,
    upstream: { name: "opencode", version: upstream.version, gitCommit: upstream.gitCommit },
    build: {
      sourceTag: b.sourceTag,
      gitCommit: b.gitCommit,
      builtAt: b.builtAt,
      workflowRunId: String(b.workflowRunId),
    },
  }
}

function parseDevelopmentKind(input: Record<string, unknown>): ReleaseIdentity {
  const channel = input.channel
  if (!isDevChannel(channel)) {
    fail("ECHANNEL", `development identity channel ${String(channel)} is not a dev channel (local|main)`)
  }

  const b = (input.build ?? {}) as Record<string, unknown>
  const allowedBuild = new Set(["gitCommit", "builtAt"])
  assertNoExtra(b, allowedBuild, "build")
  if (b.sourceTag !== undefined) {
    fail("ESOURCETAG", `development identity must not carry build.sourceTag`)
  }
  if (b.workflowRunId !== undefined) {
    fail("ERUN", `development identity must not carry build.workflowRunId`)
  }
  if (b.gitCommit !== undefined && (typeof b.gitCommit !== "string" || !COMMIT_RE.test(b.gitCommit))) {
    fail("ECOMMIT", `development identity build.gitCommit is not a 40-char SHA`)
  }
  if (b.builtAt !== undefined && (typeof b.builtAt !== "string" || !ISO8601_RE.test(b.builtAt))) {
    fail("ETIME", `development identity build.builtAt is not ISO-8601 UTC`)
  }

  return {
    schemaVersion: 2,
    kind: "development",
    product: input.product as Product,
    version: input.version as string,
    channel,
    build: {
      ...(typeof b.gitCommit === "string" ? { gitCommit: b.gitCommit } : {}),
      ...(typeof b.builtAt === "string" ? { builtAt: b.builtAt } : {}),
    },
  }
}

/** Assert that a channel and a standard version are consistent. */
export function assertChannelVersionConsistent(channel: string, version: string) {
  const parsed = parseReleaseVersion(version)
  if (channel === "stable" && parsed.channel !== "stable") {
    fail("ECHANNEL", `stable channel cannot carry prerelease version ${version}`)
  }
  if (channel === "beta" && parsed.channel !== "beta") {
    fail("ECHANNEL", `beta channel requires -beta.N version, got ${version}`)
  }
  if (channel === "rc" && parsed.channel !== "rc") {
    fail("ECHANNEL", `rc channel requires -rc.N version, got ${version}`)
  }
}

export type ParsedVersion = {
  major: number
  minor: number
  patch: number
  prerelease: Prerelease | null
  channel: "stable" | "beta" | "rc"
}

/** Parse a standard Ellamaka product version. */
export function parseReleaseVersion(version: string): ParsedVersion {
  if (typeof version !== "string") fail("EINVAL", "version must be a string")
  if (version.includes("+")) {
    fail("EBUILD", `version ${version} contains +build metadata, which is forbidden`)
  }
  let m = version.match(SEMVER_BETA_RE)
  if (m) {
    return {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      prerelease: { kind: "beta", n: Number(m[4]) },
      channel: "beta",
    }
  }
  m = version.match(SEMVER_RC_RE)
  if (m) {
    return {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      prerelease: { kind: "rc", n: Number(m[4]) },
      channel: "rc",
    }
  }
  m = version.match(SEMVER_RE)
  if (m) {
    return {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      prerelease: null,
      channel: "stable",
    }
  }
  fail("EINVAL", `version ${version} is not a valid Ellamaka SemVer subset`)
}

export const RELEASE_IDENTITY_PRODUCTS = PRODUCTS
export const RELEASE_CHANNELS_LIST = RELEASE_CHANNELS
export const DEV_CHANNELS_LIST = DEV_CHANNELS

// Build-time defines embedded by packages/ellamaka/build.ts. These are
// provided as string JSON / string literals; declared here so the runtime
// twin of the identity module can read them without redeclaring the
// OPENCODE_VERSION / OPENCODE_CHANNEL globals owned by
// packages/core/src/installation/version.ts.
declare global {
  const OPENCODE_RELEASE_IDENTITY: string | undefined
  const OPENCODE_ENGINE_API: string | undefined
}

export * as ReleaseIdentity from "./identity"
