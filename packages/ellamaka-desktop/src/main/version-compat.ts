// packages/ellamaka-desktop/src/main/version-compat.ts
//
// Compatibility gate between Desktop and external CLI. Per
// docs/DISTRIBUTION.md §6, Desktop reads CLI stable latest and
// validates product/channel/upstream baseline (v1) and engine API range.
// v2 omits upstreamBaseline.

export type ReleaseIdentity = {
  schemaVersion: 2
  kind: "release" | "development"
  product: string
  version: string
  channel: string
  upstream?: { name: string; version: string; gitCommit: string }
  build?: unknown
}

export type DesktopRequirements = {
  externalCli: {
    product: string
    channel: string
    engineApi: string
    upstreamBaseline?: string
    selection: string
  }
  wopalCli: string
}

export type CompatibilityResult = {
  compatible: boolean
  reason?: string
}

// Minimal SemVer range checker: supports ">=X.Y.Z <A.B.C" and ">=X.Y.Z".
function satisfiesRange(version: string, range: string): boolean {
  const parts = version.split(".").map((n) => Number(n))
  if (parts.length !== 3 || parts.some(isNaN)) return false
  const [major, minor, patch] = parts
  const tokens = range.split(/\s+/).filter(Boolean)
  for (const tok of tokens) {
    const m = tok.match(/^(>=|<=|>|<|=)(\d+)\.(\d+)\.(\d+)$/)
    if (!m) continue
    const op = m[1]
    const rMajor = Number(m[2])
    const rMinor = Number(m[3])
    const rPatch = Number(m[4])
    const cmp = major * 1e9 + minor * 1e6 + patch * 1e3 - (rMajor * 1e9 + rMinor * 1e6 + rPatch * 1e3)
    if (op === ">=" && cmp < 0) return false
    if (op === ">" && cmp <= 0) return false
    if (op === "<=" && cmp > 0) return false
    if (op === "<" && cmp >= 0) return false
    if (op === "=" && cmp !== 0) return false
  }
  return true
}

/**
 * Parse and validate a ReleaseIdentity object. Throws on invalid identity.
 * Reuses the same semantics as packages/opencode/src/release/identity.ts
 * but kept local to avoid a cross-package runtime dependency in Desktop.
 */
export function parseReleaseIdentity(input: unknown): ReleaseIdentity {
  if (!input || typeof input !== "object") throw new Error("identity must be an object")
  const raw = input as Record<string, unknown>
  if (raw.schemaVersion !== 2) throw new Error("schemaVersion must be 2")
  if (raw.kind !== "release" && raw.kind !== "development") throw new Error(`invalid kind ${String(raw.kind)}`)
  if (typeof raw.product !== "string") throw new Error("product must be a string")
  if (typeof raw.version !== "string") throw new Error("version must be a string")
  if (typeof raw.channel !== "string") throw new Error("channel must be a string")
  return raw as unknown as ReleaseIdentity
}

/**
 * Check compatibility between a CLI release identity and Desktop
 * requirements. Per docs/DISTRIBUTION.md §6.1:
 * 1. product must match
 * 2. channel must match requirements.externalCli.channel
 * 3. (v1) upstream baseline must be equal
 * 4. engineApi must satisfy the range
 *
 * When called without arguments (legacy callers in index.ts), returns
 * compatible=true. The real gate is exercised by the updater path which
 * provides the full inputs.
 */
export function checkVersionCompatibility(opts?: {
  cliIdentity: ReleaseIdentity
  cliEngineApi: string
  desktopRequirements: DesktopRequirements
}): CompatibilityResult {
  if (!opts) return { compatible: true }
  const { cliIdentity, cliEngineApi, desktopRequirements } = opts
  const req = desktopRequirements.externalCli

  if (cliIdentity.product !== req.product) {
    return { compatible: false, reason: `product mismatch: ${cliIdentity.product} != ${req.product}` }
  }
  if (cliIdentity.channel !== req.channel) {
    return { compatible: false, reason: `channel mismatch: ${cliIdentity.channel} != ${req.channel}` }
  }
  // v1: upstream baseline equality. v2 omits upstreamBaseline.
  if (req.upstreamBaseline !== undefined) {
    const cliUpstream = cliIdentity.upstream?.version
    if (cliUpstream !== req.upstreamBaseline) {
      return {
        compatible: false,
        reason: `upstream baseline mismatch: ${cliUpstream ?? "absent"} != ${req.upstreamBaseline}`,
      }
    }
  }
  if (!satisfiesRange(cliEngineApi, req.engineApi)) {
    return { compatible: false, reason: `engineApi ${cliEngineApi} does not satisfy ${req.engineApi}` }
  }
  return { compatible: true }
}
