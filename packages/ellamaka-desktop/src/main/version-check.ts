// packages/ellamaka-desktop/src/main/version-check.ts
//
// Runtime version guarantee checks shared by the updater transaction and
// the onboarding flow (docs/RELEASE-IDENTITY.md §7, DESIGN-capability-contract
// §7). Pure functions — no electron imports — so they can be tested without
// the electron mock (same pattern as version-compat.ts).
//
// Two checks:
//   - checkWopalCliVersion: installed wopal-cli must be >= the protocol
//     compatibility floor (MIN_WOPAL_CLI_VERSION). dev/prerelease versions
//     are normalized to their base version before comparison.
//   - checkEngineMajorMinor: the installed ellamaka CLI must share the
//     Desktop's major.minor (patch and prerelease are ignored).

import semver from "semver"

export type VersionCheckResult = { ok: true } | { ok: false; reason: string }

export type AuthorizeVersionChecksInput = {
  wopalCliVersion: string
  minWopalCliVersion: string
  desktopVersion: string
  engineCliVersion: string
}

export type AuthorizeVersionChecksResult = { authorized: true } | { authorized: false; reason: string }

// Normalize a version string to a comparable SemVer base. dev/prerelease
// suffixes (e.g. "0.3.14-dev", "2.0.3-beta.1") are stripped so comparisons
// operate on the release part only (semver.valid keeps the prerelease, so
// coerce is applied unconditionally to obtain the base). Returns null when
// the input cannot be parsed as a version at all.
function normalizeVersion(version: string): string | null {
  const trimmed = version.trim().replace(/^v/, "")
  if (!trimmed) return null
  const coerced = semver.coerce(trimmed)
  return coerced ? coerced.version : null
}

/**
 * Check that the installed wopal-cli version satisfies the minimum required
 * version (>= semantics). dev/prerelease versions are compared by their
 * normalized base version.
 */
export function checkWopalCliVersion(installed: string, min: string): VersionCheckResult {
  const actual = normalizeVersion(installed)
  const required = normalizeVersion(min)
  if (!actual) {
    return { ok: false, reason: `cannot parse installed wopal-cli version: ${installed}` }
  }
  if (!required) {
    return { ok: false, reason: `cannot parse minimum wopal-cli version: ${min}` }
  }
  if (semver.lt(actual, required)) {
    return {
      ok: false,
      reason: `Wopal CLI version too low (${installed}). Minimum required is ${min}.`,
    }
  }
  return { ok: true }
}

/**
 * Check that the installed ellamaka CLI shares the Desktop's major.minor.
 * Patch and prerelease parts are ignored.
 */
export function checkEngineMajorMinor(desktopVersion: string, cliVersion: string): VersionCheckResult {
  const desktop = normalizeVersion(desktopVersion)
  const cli = normalizeVersion(cliVersion)
  if (!desktop) {
    return { ok: false, reason: `cannot parse desktop version: ${desktopVersion}` }
  }
  if (!cli) {
    return { ok: false, reason: `cannot parse ellamaka CLI version: ${cliVersion}` }
  }
  const desktopMajorMinor = `${semver.major(desktop)}.${semver.minor(desktop)}`
  const cliMajorMinor = `${semver.major(cli)}.${semver.minor(cli)}`
  if (desktopMajorMinor !== cliMajorMinor) {
    return {
      ok: false,
      reason: `Ellamaka CLI version ${cliVersion} does not match Desktop major.minor ${desktopMajorMinor}. Please reinstall the engine.`,
    }
  }
  return { ok: true }
}

/**
 * Combined runtime version gate used by the updater transaction (after
 * policy authorization, before download) and the onboarding flow. Runs the
 * wopal-cli floor check first, then the engine major.minor match; the first
 * failure short-circuits with its reason.
 */
export function authorizeVersionChecks(input: AuthorizeVersionChecksInput): AuthorizeVersionChecksResult {
  const wopal = checkWopalCliVersion(input.wopalCliVersion, input.minWopalCliVersion)
  if (!wopal.ok) return { authorized: false, reason: wopal.reason }
  const engine = checkEngineMajorMinor(input.desktopVersion, input.engineCliVersion)
  if (!engine.ok) return { authorized: false, reason: engine.reason }
  return { authorized: true }
}
