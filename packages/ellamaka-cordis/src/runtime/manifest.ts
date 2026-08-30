import { createHash } from "node:crypto"

// ---------------------------------------------------------------------------
// Runtime manifest types & pure helpers for the DSH production materialisation
// (DESIGN-dsh-poc.md §3.4.3). Deterministic, side-effect-free transforms: they
// never touch the network and never read the registry directly.
// ---------------------------------------------------------------------------

export interface DshRuntimeManifestV1 {
  schema: "ellamaka.dsh-runtime/v1"
  bridgeAbi: number
  dependencies: Record<string, string>
  packageLock: Record<string, unknown>
  registry?: string
  fingerprint?: string
}

/** Minimum view of the workspace lock file. */
export interface BunLockFile {
  lockfileVersion: number
  packages: Record<string, unknown>
}

/** The subset of package.json that carries DSH official direct dependencies. */
export interface DshDependencies {
  dependencies?: Record<string, string>
}

/** The manifest schema string this runtime understands. */
export const DSH_RUNTIME_SCHEMA = "ellamaka.dsh-runtime/v1"
export const DSH_RUNTIME_ABI = 1

/** Packages resolved by name in the lock; undefined when the lock lacks them. */
export type LockPackages = Record<string, unknown>

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

/**
 * Deep-canonicalize a JSON-serializable value: object keys are sorted and
 * nested arrays/objects normalized so the byte stream is stable regardless of
 * insertion order. Used both for the fingerprint hash and the emitted file.
 */
export function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalSerialize(v)).join(",")}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalSerialize(v)}`).join(",")}}`
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * SHA-256 digest over canonical JSON of every field except the manifest's own
 * `fingerprint` (HASH/get phase). Returns `sha256:<hex>`.
 */
export function computeManifestFingerprint(m: DshRuntimeManifestV1): string {
  const { fingerprint: _fp, ...rest } = m
  const digest = createHash("sha256").update(canonicalSerialize(rest)).digest("hex")
  return `sha256:${digest}`
}

// ---------------------------------------------------------------------------
// Schema parsing
// ---------------------------------------------------------------------------

function assertManifestShape(raw: unknown): asserts raw is DshRuntimeManifestV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("dsh runtime manifest: expected an object")
  }
  const m = raw as Partial<DshRuntimeManifestV1>
  if (m.schema !== DSH_RUNTIME_SCHEMA) {
    throw new Error(
      `dsh runtime manifest: unsupported schema "${String(m.schema)}" (expected "${DSH_RUNTIME_SCHEMA}")`,
    )
  }
  if (typeof m.bridgeAbi !== "number") {
    throw new Error("dsh runtime manifest: missing required numeric field `bridgeAbi`")
  }
  if (typeof m.dependencies !== "object" || m.dependencies === null) {
    throw new Error("dsh runtime manifest: missing required object field `dependencies`")
  }
}

/** Parse a raw manifest string and validate its schema/ABI shape. */
export function parseDshRuntimeManifest(raw: string): DshRuntimeManifestV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("dsh runtime manifest: invalid JSON")
  }
  assertManifestShape(parsed)
  return parsed
}

// ---------------------------------------------------------------------------
// Lock closure extraction
// ---------------------------------------------------------------------------

interface ResolvedPackage {
  name: string
  version: string
  tarballUrl?: string
  spec?: Record<string, string | undefined>
  integrity?: string
}

/** Parse a single resolved lock entry into a stable record. */
function parseResolved(name: string, entry: unknown): ResolvedPackage {
  if (!Array.isArray(entry) || entry.length === 0) {
    // Workspace / non-registry aliases collapse to a bare [name@alias]. The DSH
    // official runtime never resolves through a workspace, so treat absent
    // version info as resolvable but not further-expandable.
    const first = Array.isArray(entry) ? String(entry[0] ?? name) : name
    return { name, version: "", spec: {}, integrity: undefined }
  }
  const head = String(entry[0])
  const at = head.lastIndexOf("@")
  const version = at > 0 ? head.slice(at + 1) : ""
  const tarballUrl = typeof entry[1] === "string" ? entry[1] : undefined
  const spec =
    entry[2] && typeof entry[2] === "object"
      ? (entry[2] as Record<string, string | undefined>)
      : {}
  const integrity = entry[3] != null ? String(entry[3]) : undefined
  return { name, version, tarballUrl, spec, integrity }
}

function reachableDeps(pkg: ResolvedPackage): string[] {
  const names = new Set<string>()
  for (const k of ["dependencies", "optionalDependencies"] as const) {
    const map = pkg.spec?.[k]
    if (map && typeof map === "object") {
      for (const depName of Object.keys(map as Record<string, unknown>)) {
        names.add(depName)
      }
    }
  }
  return [...names]
}

/**
 * Compute the closure of DSH official direct dependencies over the lock file's
 * resolved `packages` map. Returns a stable object keyed by package name whose
 * values are the canonical lock entries for the reachable packages.
 *
 * Throws when a reached package (direct or transitive) is missing from the
 * lock, naming the missing package.
 */
export function extractPackageLock(
  pkg: DshDependencies,
  lock: BunLockFile,
): LockPackages {
  const deps = pkg.dependencies ?? {}
  const lockPkgs = lock.packages ?? {}

  const closure = new Map<string, ResolvedPackage>()
  const visit = (name: string): void => {
    if (closure.has(name)) return
    if (!(name in lockPkgs)) {
      throw new Error(
        `dsh runtime manifest: lock file missing direct dependency package "${name}"`,
      )
    }
    const resolved = parseResolved(name, lockPkgs[name])
    closure.set(name, resolved)
    for (const dep of reachableDeps(resolved)) {
      visit(dep)
    }
  }

  for (const name of Object.keys(deps)) {
    visit(name)
  }

  const out: LockPackages = {}
  for (const name of [...closure.keys()].sort()) {
    out[name] = lockPkgs[name]
  }
  return out
}

// ---------------------------------------------------------------------------
// Manifest assembly
// ---------------------------------------------------------------------------

/**
 * Build a complete runtime manifest from the package's DSH dependencies and the
 * workspace lock file. Deterministic for identical inputs: the emitted JSON and
 * the fingerprint are derived purely from the two sources.
 */
export function buildDshRuntimeManifest(
  pkg: DshDependencies,
  lock: BunLockFile,
  registry?: string,
): DshRuntimeManifestV1 {
  const dependencies: Record<string, string> = {}
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    if (name.startsWith("@deepseek-ai/") || name === "@deepseek-ai/dsh") {
      dependencies[name] = version
    }
  }

  const manifest: DshRuntimeManifestV1 = {
    schema: DSH_RUNTIME_SCHEMA,
    bridgeAbi: DSH_RUNTIME_ABI,
    dependencies,
    packageLock: extractPackageLock(pkg, lock),
  }
  if (registry) manifest.registry = registry
  manifest.fingerprint = computeManifestFingerprint(manifest)
  return manifest
}

/** Derive the registry origin from any resolved entry's tarball URL, if present. */
export function deriveRegistry(pkg: DshDependencies, lock: BunLockFile): string | undefined {
  const deps = pkg.dependencies ?? {}
  const lockPkgs: LockPackages = lock.packages ?? {}
  for (const name of Object.keys(deps)) {
    if (name in lockPkgs) {
      const url = parseResolved(name, lockPkgs[name]).tarballUrl
      if (url) return new URL(url).origin
    }
  }
  return undefined
}
