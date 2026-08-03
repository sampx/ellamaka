// release-identity.mjs — Ellamaka ReleaseIdentity core model
//
// Single source of truth for parsing, validating and building the
// `release`/`development` discriminated union defined in
// docs/RELEASE-IDENTITY.md. New publishers must consume this module; the
// legacy `X.Y.Z-N` comparator is intentionally not re-exported.
//
// This file is consumed by:
//   - packages/ellamaka/test/release-identity.test.ts (contract tests)
//   - scripts/release-context.mjs (release-context assembly)
//   - scripts/release-identity.mjs is also the build-time helper for the
//     TS twin in packages/opencode/src/release/identity.ts (Task 2 keeps
//     the TS surface in sync with this module's semantics).

import fs from "fs"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRODUCTS = ["ellamaka-cli", "ellamaka-desktop"]
const RELEASE_CHANNELS = ["stable", "beta"]
const DEV_CHANNELS = ["local", "main"]
const COMMIT_RE = /^[0-9a-f]{40}$/
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

// SemVer 2.0 subset used for Ellamaka product versions.
//   CLI stable: X.Y.Z
//   Desktop beta: X.Y.Z-beta.N
// rc is not a release shape for either product (rc mechanism removed).
// +build metadata and the legacy X.Y.Z-N / X.Y.Z-N.rcM shapes are not
// accepted by the new publisher. The legacy reader (parseLegacyVersion)
// owns the legacy shapes.
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SEMVER_BETA_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/
const SEMVER_RC_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.(0|[1-9]\d*)$/

// Legacy shapes (read-only): X.Y.Z-N and X.Y.Z-N.rcM
const LEGACY_STABLE_ITERATION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-(\d+)$/
const LEGACY_RC_ITERATION_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-(\d+)\.rc(\d+)$/

// Namespaced product tag: ellamaka-cli-vX.Y.Z[...]
const NAMESPACED_TAG_RE = /^(ellamaka-cli|ellamaka-desktop)-v(.+)$/

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ReleaseIdentityError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = "ReleaseIdentityError"
    this.code = code
  }
}

function fail(code, message) {
  throw new ReleaseIdentityError(code, message)
}

// ---------------------------------------------------------------------------
// parseReleaseVersion — standard SemVer subset
// ---------------------------------------------------------------------------

/**
 * Parse a standard Ellamaka product version. Returns the structured form.
 * Throws on legacy `X.Y.Z-N`, `+build` and non-SemVer input.
 */
export function parseReleaseVersion(version) {
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

  // rc is not a release shape (rc mechanism removed). Diagnose it clearly
  // so a stale rc version is rejected rather than mis-classified.
  m = version.match(SEMVER_RC_RE)
  if (m) {
    fail("ERC", `version ${version} is an rc shape; rc releases are removed — use a stable X.Y.Z`)
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

  // Diagnose legacy shape for a clearer error.
  if (LEGACY_STABLE_ITERATION_RE.test(version) || LEGACY_RC_ITERATION_RE.test(version)) {
    fail("ELEGACY", `version ${version} is a legacy X.Y.Z-N shape; use standard SemVer for new releases`)
  }
  fail("EINVAL", `version ${version} is not a valid Ellamaka SemVer subset`)
}

// ---------------------------------------------------------------------------
// Channel / version consistency
// ---------------------------------------------------------------------------

const FEED_TO_CHANNEL = { prod: "stable", beta: "beta" }

/** Normalize a feed name (e.g. Desktop "prod") to identity channel. */
export function normalizeFeedChannel(feed) {
  if (feed in FEED_TO_CHANNEL) return FEED_TO_CHANNEL[feed]
  return feed
}

/** Assert that a channel and a standard version are consistent. */
export function assertChannelVersionConsistent(channel, version) {
  if (!RELEASE_CHANNELS.includes(channel)) {
    fail("ECHANNEL", `unknown release channel ${channel}; release channels are ${RELEASE_CHANNELS.join(", ")}`)
  }
  const parsed = parseReleaseVersion(version)
  if (channel === "stable" && parsed.channel !== "stable") {
    fail("ECHANNEL", `stable channel cannot carry prerelease version ${version}`)
  }
  if (channel === "beta" && parsed.channel !== "beta") {
    fail("ECHANNEL", `beta channel requires -beta.N version, got ${version}`)
  }
}

// ---------------------------------------------------------------------------
// Namespaced tag
// ---------------------------------------------------------------------------

/** Build `ellamaka-cli-v1.17.1` from product + version. */
export function buildNamespacedTag(product, version) {
  if (!PRODUCTS.includes(product)) fail("EPRODUCT", `unknown product ${product}`)
  // Validate version shape (throws on legacy/build).
  parseReleaseVersion(version)
  return `${product}-v${version}`
}

/** Parse a namespaced tag into product + version. */
export function parseNamespacedTag(tag) {
  const m = tag.match(NAMESPACED_TAG_RE)
  if (!m) {
    fail("ENAMESPACED", `tag ${tag} is not a namespaced product tag (ellamaka-{cli,desktop}-vX.Y.Z)`)
  }
  return { product: m[1], version: m[2] }
}

// ---------------------------------------------------------------------------
// Upstream lock
// ---------------------------------------------------------------------------

/** Load and JSON-parse an upstream lock file. */
export function loadUpstreamLock(path) {
  const data = JSON.parse(fs.readFileSync(path, "utf8"))
  return data
}

/** Validate upstream lock schema: stable versions, 40-char commits. */
export function validateUpstreamLock(lock) {
  if (lock.schemaVersion !== 1) fail("ESCHEMA", `upstream lock schemaVersion must be 1`)
  const src = lock.sources?.opencode
  if (!src) fail("ESCHEMA", `upstream lock missing sources.opencode`)
  if (!SEMVER_RE.test(src.version)) {
    fail("EVERSION", `upstream version ${src.version} is not stable SemVer`)
  }
  if (!COMMIT_RE.test(src.gitCommit)) {
    fail("ECOMMIT", `upstream gitCommit ${src.gitCommit} is not a 40-char SHA`)
  }
  for (const [key, entry] of Object.entries(lock.componentBaselines || {})) {
    if (!SEMVER_RE.test(entry.version)) {
      fail("EVERSION", `component ${key} version ${entry.version} is not stable SemVer`)
    }
    if (!COMMIT_RE.test(entry.gitCommit)) {
      fail("ECOMMIT", `component ${key} gitCommit ${entry.gitCommit} is not a 40-char SHA`)
    }
  }
  return lock
}

// ---------------------------------------------------------------------------
// buildReleaseIdentity
// ---------------------------------------------------------------------------

/**
 * Build a release-kind ReleaseIdentity. upstream is sourced exclusively from
 * the lock; caller cannot override it. build.sourceTag is derived from the
 * product + version.
 */
export function buildReleaseIdentity({
  product,
  version,
  channel,
  upstreamLock,
  gitCommit,
  builtAt,
  workflowRunId,
}) {
  if (!PRODUCTS.includes(product)) fail("EPRODUCT", `unknown product ${product}`)
  const validated = validateUpstreamLock(upstreamLock)
  assertChannelVersionConsistent(channel, version)

  if (!COMMIT_RE.test(gitCommit)) {
    fail("ECOMMIT", `build.gitCommit ${gitCommit} is not a 40-char SHA`)
  }
  if (!ISO8601_RE.test(builtAt)) {
    fail("ETIME", `build.builtAt ${builtAt} is not ISO-8601 UTC`)
  }
  if (!workflowRunId) fail("ERUN", `build.workflowRunId is required for release identity`)

  const src = validated.sources.opencode
  const expectedSourceTag = buildNamespacedTag(product, version)
  return {
    schemaVersion: 2,
    kind: "release",
    product,
    version,
    channel,
    upstream: {
      name: "opencode",
      version: src.version,
      gitCommit: src.gitCommit,
    },
    build: {
      sourceTag: expectedSourceTag,
      gitCommit,
      builtAt,
      workflowRunId: String(workflowRunId),
    },
  }
}

// ---------------------------------------------------------------------------
// parseReleaseIdentity — discriminated union
// ---------------------------------------------------------------------------

function assertNoExtra(obj, allowed, where) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail("ESCHEMA", `unexpected field ${where}.${key}`)
    }
  }
}

/**
 * Parse and validate a ReleaseIdentity object (release or development kind).
 * Enforces required/forbidden fields per kind.
 */
export function parseReleaseIdentity(input) {
  if (!input || typeof input !== "object") fail("EINVAL", "identity must be an object")
  if (input.schemaVersion !== 2) fail("ESCHEMA", `schemaVersion must be 2`)
  if (!PRODUCTS.includes(input.product)) fail("EPRODUCT", `unknown product ${input.product}`)
  if (typeof input.version !== "string") fail("EINVAL", "version must be a string")
  if (input.version.includes("+")) {
    fail("EBUILD", `version ${input.version} contains +build metadata, which is forbidden`)
  }

  if (input.kind === "release") {
    return parseReleaseKind(input)
  }
  if (input.kind === "development") {
    return parseDevelopmentKind(input)
  }
  fail("EKIND", `unknown kind ${input.kind}; expected release|development`)
}

function parseReleaseKind(input) {
  if (!RELEASE_CHANNELS.includes(input.channel)) {
    fail("ECHANNEL", `release identity channel ${input.channel} is not a release channel`)
  }
  assertChannelVersionConsistent(input.channel, input.version)

  const b = input.build || {}
  const allowed = new Set(["sourceTag", "gitCommit", "builtAt", "workflowRunId"])
  assertNoExtra(b, allowed, "build")
  if (typeof b.sourceTag !== "string" || !b.sourceTag) {
    fail("ESOURCETAG", `release identity build.sourceTag is required`)
  }
  if (!COMMIT_RE.test(b.gitCommit)) {
    fail("ECOMMIT", `release identity build.gitCommit ${b.gitCommit} is not a 40-char SHA`)
  }
  if (typeof b.builtAt !== "string" || !ISO8601_RE.test(b.builtAt)) {
    fail("ETIME", `release identity build.builtAt is not ISO-8601 UTC`)
  }
  if (b.workflowRunId === undefined || b.workflowRunId === null || b.workflowRunId === "") {
    fail("ERUN", `release identity build.workflowRunId is required`)
  }

  const upstream = input.upstream || {}
  if (upstream.name !== "opencode") fail("EUPSTREAM", `upstream.name must be opencode`)
  if (!upstream.version || !SEMVER_RE.test(upstream.version)) {
    fail("EVERSION", `upstream.version ${upstream.version} is not stable SemVer`)
  }
  if (!COMMIT_RE.test(upstream.gitCommit)) {
    fail("ECOMMIT", `upstream.gitCommit ${upstream.gitCommit} is not a 40-char SHA`)
  }

  return {
    schemaVersion: 2,
    kind: "release",
    product: input.product,
    version: input.version,
    channel: input.channel,
    upstream: { name: "opencode", version: upstream.version, gitCommit: upstream.gitCommit },
    build: {
      sourceTag: b.sourceTag,
      gitCommit: b.gitCommit,
      builtAt: b.builtAt,
      workflowRunId: String(b.workflowRunId),
    },
  }
}

function parseDevelopmentKind(input) {
  if (!DEV_CHANNELS.includes(input.channel)) {
    fail("ECHANNEL", `development identity channel ${input.channel} is not a dev channel (local|main)`)
  }

  const b = input.build || {}
  const allowed = new Set(["gitCommit", "builtAt"])
  assertNoExtra(b, allowed, "build")
  if (b.sourceTag !== undefined) {
    fail("ESOURCETAG", `development identity must not carry build.sourceTag`)
  }
  if (b.workflowRunId !== undefined) {
    fail("ERUN", `development identity must not carry build.workflowRunId`)
  }
  if (b.gitCommit !== undefined && !COMMIT_RE.test(b.gitCommit)) {
    fail("ECOMMIT", `development identity build.gitCommit ${b.gitCommit} is not a 40-char SHA`)
  }
  if (b.builtAt !== undefined && !ISO8601_RE.test(b.builtAt)) {
    fail("ETIME", `development identity build.builtAt is not ISO-8601 UTC`)
  }

  return {
    schemaVersion: 2,
    kind: "development",
    product: input.product,
    version: input.version,
    channel: input.channel,
    build: {
      ...(b.gitCommit ? { gitCommit: b.gitCommit } : {}),
      ...(b.builtAt ? { builtAt: b.builtAt } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// Legacy reader (read-only)
// ---------------------------------------------------------------------------

/**
 * Parse a legacy `X.Y.Z-N` or `X.Y.Z-N.rcM` version. The result is never
 * convertible to a new release identity; it only supports classification
 * and inventory freezing.
 */
export function parseLegacyVersion(version) {
  let m = version.match(LEGACY_RC_ITERATION_RE)
  if (m) {
    return {
      kind: "legacy",
      legacyShape: "rc-iteration",
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      iteration: Number(m[4]),
      rcN: Number(m[5]),
      convertibleToRelease: false,
    }
  }
  m = version.match(LEGACY_STABLE_ITERATION_RE)
  if (m) {
    return {
      kind: "legacy",
      legacyShape: "stable-iteration",
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      iteration: Number(m[4]),
      convertibleToRelease: false,
    }
  }
  if (SEMVER_RE.test(version) || SEMVER_BETA_RE.test(version) || SEMVER_RC_RE.test(version)) {
    fail("ELEGACY", `version ${version} is not a legacy shape`)
  }
  fail("EINVAL", `version ${version} is not a recognized legacy shape`)
}

// ---------------------------------------------------------------------------
// Migration floor
// ---------------------------------------------------------------------------

/**
 * Compute the migration floor for a product from a legacy inventory.
 *
 * The floor is the lowest standard SemVer that sorts above every legacy
 * release for that product. Legacy shapes are `X.Y.Z-N` prereleases, so
 * per SemVer 2.0 the same-base stable `X.Y.Z` already sorts above them.
 * The floor is therefore the base of the highest legacy version (e.g.
 * `1.15.13-4` → floor `1.15.13`), not `X.Y.(Z+1).0`. A later patch
 * (`1.15.14`) passes; the exact same-base version is additionally guarded
 * by the tag/R2 occupancy checks, which are not the floor's concern.
 * Products with no legacy entries default to `1.0.0`.
 */
export function computeMigrationFloor(inventory, product) {
  const entries = inventory?.products?.[product]
  if (!entries) return "1.0.0"

  let highest = null
  for (const tag of entries.tags || []) {
    try {
      const legacy = parseLegacyVersion(tag.name.replace(/^v/, ""))
      if (!highest || compareLegacyToFloor(highest, legacy) < 0) {
        highest = legacy
      }
    } catch {
      // Unparsable tag — recorded in inventory, not used for floor.
    }
  }
  for (const m of entries.manifests || []) {
    try {
      const legacy = parseLegacyVersion(m.version)
      if (!highest || compareLegacyToFloor(highest, legacy) < 0) {
        highest = legacy
      }
    } catch {
      // skip
    }
  }

  if (!highest) return "1.0.0"
  return `${highest.major}.${highest.minor}.${highest.patch}`
}

// Compare two legacy records by (major, minor, patch, iteration, rcN).
function compareLegacyToFloor(a, b) {
  const ka = [a.major, a.minor, a.patch, a.iteration, a.rcN ?? 0]
  const kb = [b.major, b.minor, b.patch, b.iteration, b.rcN ?? 0]
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i]
  }
  return 0
}

/**
 * Assert that a new release version is above the migration floor for its
 * product. Inventory must have been reviewed and frozen.
 */
export function assertVersionAboveMigrationFloor(product, version, inventory) {
  const floor = computeMigrationFloor(inventory, product)
  if (compareSemVer(version, floor) < 0) {
    fail("EMIGRATION", `version ${version} is below migration floor ${floor} for ${product}`)
  }
  // Equal to floor is allowed (floor is the first acceptable version).
}

// ---------------------------------------------------------------------------
// SemVer precedence (standard, no legacy)
// ---------------------------------------------------------------------------

function prereleaseRank(parsed) {
  if (!parsed.prerelease) return 3 // stable > rc > beta
  if (parsed.prerelease.kind === "beta") return 1
  if (parsed.prerelease.kind === "rc") return 2
  return 0
}

/**
 * Compare two standard Ellamaka SemVer versions.
 * Returns <0, 0, >0 like Array.prototype.sort.
 */
export function compareSemVer(a, b) {
  const pa = parseReleaseVersion(a)
  const pb = parseReleaseVersion(b)
  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch
  const ra = prereleaseRank(pa)
  const rb = prereleaseRank(pb)
  if (ra !== rb) return ra - rb
  if (pa.prerelease && pb.prerelease) {
    return pa.prerelease.n - pb.prerelease.n
  }
  return 0
}
