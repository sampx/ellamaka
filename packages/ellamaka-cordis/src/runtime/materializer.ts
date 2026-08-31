import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { rename } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Arborist } from "@npmcli/arborist"
import type { DshRuntimeManifestV1 } from "./manifest.js"
import { canonicalSerialize } from "./manifest.js"
import { closureNameForFingerprint, expandCacheDir, resolveDshLayout, type DshLayout } from "./status.js"
import type { LogBridge } from "./log.js"

/**
 * Closure materialiser (DESIGN §3.4.5 stages 5-7).
 *
 * Pure-injection seams:
 * - `deps.arborist` is the only network/install boundary. Production resolves
 *   the real `@npmcli/arborist` (a runtime dependency of this package) with an
 *   explicit `~/.npm/_cacache` cache so cross-closure common deps hit the
 *   cache and interrupted retries only fill gaps; tests inject a fake whose
 *   `reify` synthesises the closure files.
 *
 * Staging lifecycle (DESIGN §3.4.7, append-only):
 * - cleared at the start (the caller holds the materialise lock);
 * - on success: the verified staging dir is atomically `rename`d into
 *   `closures/<fingerprint>/` and staging is drained;
 * - on failure: the staging scene is kept for diagnosis; the next materialise
 *   overwrites it. A failed staging never overwrites an activated closure.
 */

export interface ArboristLike {
  reify(opts?: Record<string, unknown>): Promise<unknown>
}

export interface ArboristFactory {
  create(opts: Record<string, unknown>): Promise<ArboristLike>
}

export interface MaterializeDeps {
  arborist?: ArboristFactory
}

export interface MaterializeResult {
  /** Absolute path to `@deepseek-ai/dsh/package.json` in the activated closure. */
  readonly anchor: string
  /** Absolute path to the activated closure directory. */
  readonly closureDir: string
}

export interface MaterializeOptions {
  readonly home: string
  readonly manifest: DshRuntimeManifestV1
  readonly deps?: MaterializeDeps
  readonly log?: LogBridge
}

/** Resolve the production Arborist factory from this package's own dependency. */
async function createRealArborist(opts: Record<string, unknown>): Promise<ArboristLike> {
  return new Arborist(opts)
}

/** The closure package.json: only the manifest's exact DSH direct dependencies. */
function closurePackageJson(manifest: DshRuntimeManifestV1): string {
  return JSON.stringify(
    {
      name: "ellamaka-dsh-closure",
      private: true,
      type: "module",
      dependencies: manifest.dependencies,
    },
    null,
    2,
  )
}

/**
 * Build an npm package-lock v3 document from the manifest's lock closure so
 * Arborist can reify deterministically (pinned versions, resolved tarball URLs
 * and integrity carried straight from the embedded lock; no `latest`, no
 * registry re-resolution). The root `""` entry declares the direct
 * dependencies so Arborist knows the install target.
 *
 * The same function is used by {@link verifyClosureContent} to canonical-bind a
 * stored closure lock to the manifest's packageLock (B-03).
 */
export function closureLockJson(manifest: DshRuntimeManifestV1): string {
  const packages: Record<string, unknown> = {
    "": { name: "ellamaka-dsh-closure", dependencies: manifest.dependencies },
  }
  for (const [name, entry] of Object.entries(manifest.packageLock)) {
    if (!Array.isArray(entry) || entry.length === 0) continue
    const [spec, tarballUrl, specObj, integrity] = entry as [
      string | undefined,
      string | undefined,
      Record<string, unknown> | undefined,
      string | undefined,
    ]
    const version = spec && spec.includes("@") ? spec.slice(spec.lastIndexOf("@") + 1) : spec ?? ""
    const record: Record<string, unknown> = { version }
    if (tarballUrl) record.resolved = tarballUrl
    if (integrity) record.integrity = integrity
    const map = specObj as Record<string, unknown> | undefined
    for (const key of ["dependencies", "peerDependencies", "optionalDependencies", "bin"] as const) {
      const value = map?.[key]
      if (value && typeof value === "object") record[key] = value
    }
    packages[`node_modules/${name}`] = record
  }
  return JSON.stringify(
    { name: "ellamaka-dsh-closure", lockfileVersion: 3, requires: true, packages },
    null,
    2,
  )
}

function anchorFor(layout: DshLayout, closureName: string): string {
  return join(
    layout.closuresDir,
    closureName,
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "package.json",
  )
}

/** Clear the staging scene. Called only while holding the materialise lock. */
async function clearStaging(layout: DshLayout, log?: LogBridge): Promise<void> {
  if (!existsSync(layout.stagingDir)) return
  log?.info("materializer.staging.clear", { stagingDir: layout.stagingDir })
  rmSync(layout.stagingDir, { recursive: true, force: true })
}

/**
 * Materialise the closure for `manifest.fingerprint` into `closures/`:
 * write manifest + lock into `staging/`, reify with Arborist (explicit npm
 * cacache cache), verify the staged tree, then atomically activate via rename.
 *
 * Throws on any failure (reify error, staged verification failure, invalid
 * install anchor) so the caller can degrade; a failed run never overwrites an
 * already-activated closure.
 */
export async function materializeClosure(options: MaterializeOptions): Promise<MaterializeResult> {
  const layout = resolveDshLayout(options.home)
  const log = options.log
  const fingerprint = options.manifest.fingerprint
  if (!fingerprint) {
    throw new Error("dsh runtime: manifest has no fingerprint to materialise")
  }
  const closureName = closureNameForFingerprint(fingerprint)
  const closureDir = join(layout.closuresDir, closureName)

  // Append-only: never overwrite a complete, working closure of this
  // fingerprint. A damaged closure (missing anchor / direct deps) is treated
  // as missing and re-materialised (DESIGN §3.4.7).
  if (isClosureComplete(closureDir, options.manifest)) {
    log?.info("materializer.activate.skip", { closureDir, reason: "exists" })
    return { anchor: anchorFor(layout, closureName), closureDir }
  }
  if (existsSync(closureDir)) {
    log?.warn("materializer.activate.replace", { closureDir, reason: "damaged" })
    rmSync(closureDir, { recursive: true, force: true })
  }

  // Self-managed staging: clear any leftover scene from a previous run.
  await clearStaging(layout, log)

  const arboristFactory = options.deps?.arborist ?? { create: createRealArborist }
  const arborist = await arboristFactory.create({
    path: layout.stagingDir,
    cache: expandCacheDir(),
    binLinks: false,
    progress: false,
    ignoreScripts: true,
    savePrefix: "",
    // The DSH dependency tree carries peer conflicts that bun tolerates but
    // Arborist's strict peer resolution rejects (`could not resolve`). `force`
    // relaxes peer-conflict errors while still installing peer dependencies
    // (unlike `legacyPeerDeps`, which skips them and leaves the closure
    // missing packages the runtime imports). The closure is a self-contained
    // install of pinned versions, so peer resolution is not needed here.
    force: true,
  })

  // Stage the manifest + lock so Arborist reifies exactly the declared closure.
  mkdirSync(layout.stagingDir, { recursive: true })
  writeFileSync(join(layout.stagingDir, "package.json"), closurePackageJson(options.manifest))
  writeFileSync(join(layout.stagingDir, "package-lock.json"), closureLockJson(options.manifest))
  // Write the runtime-manifest into staging so content verification (B-02/B-03)
  // can run against the staged tree before activation.
  writeFileSync(join(layout.stagingDir, "runtime-manifest.json"), JSON.stringify(options.manifest))
  log?.info("materializer.reify", { fingerprint, cache: expandCacheDir() })

  await arborist.reify({ save: false, saveType: "prod" })

  // Verify the staged tree CONTENT before activation (B-02). Existence alone is
  // not enough: a staged direct dep installed at the wrong version must fail
  // here, keep staging for diagnosis, and never activate. This runs the same
  // full verifyClosureContent() used by the fast-path inspect (canonical
  // runtime-manifest compare + pinned dep versions + lock binding).
  const stagedClosureDir = layout.stagingDir
  const missing = directDepsMissingOnDisk({
    closureDir: stagedClosureDir,
    manifest: options.manifest,
  })
  const stagedAnchor = join(stagedClosureDir, "node_modules", "@deepseek-ai", "dsh", "package.json")
  if (missing.length > 0 || !existsSync(stagedAnchor)) {
    throw new Error(
      `dsh runtime: staged closure verification failed (missing ${[stagedAnchor, ...missing].filter(Boolean).join(", ")})`,
    )
  }
  try {
    verifyClosureContent(stagedClosureDir, options.manifest)
  } catch (error) {
    // Keep staging for diagnosis; never activate a wrong-version tree (B-02).
    log?.warn("materializer.verify.staged.failed", { error })
    throw new Error(`dsh runtime: staged closure content verification failed: ${(error as Error).message}`)
  }
  log?.info("materializer.verify", { fingerprint, packages: Object.keys(options.manifest.dependencies).length })

  // Atomically activate: rename staging → closures/<fingerprint>.
  mkdirSync(dirname(closureDir), { recursive: true })
  if (existsSync(closureDir)) {
    // Another process activated the same closure while we installed; adopt it.
    await clearStaging(layout, log)
    log?.info("materializer.activate.adopt", { closureDir })
    return { anchor: anchorFor(layout, closureName), closureDir }
  }
  await rename(layout.stagingDir, closureDir)
  writeFileSync(join(closureDir, "runtime-manifest.json"), JSON.stringify(options.manifest))
  log?.info("materializer.activate", { closureDir, fingerprint })
  return { anchor: anchorFor(layout, closureName), closureDir }
}

/** Direct dependency package.json paths missing under a closure dir. */
function directDepsMissingOnDisk(options: {
  closureDir: string
  manifest: DshRuntimeManifestV1
}): string[] {
  const missing: string[] = []
  for (const name of Object.keys(options.manifest.dependencies)) {
    const pkgPath = join(options.closureDir, "node_modules", ...name.split("/"), "package.json")
    if (!existsSync(pkgPath)) missing.push(name)
  }
  return missing
}

/**
 * Verify the closure's CONTENT against the embedded manifest (B-03). A closure
 * whose files merely exist is not trustworthy: a tampered
 * `runtime-manifest.json`, a truncated/corrupt `package-lock.json`, or a
 * direct dependency installed at the wrong version must be treated as damaged
 * and re-materialised.
 *
 * Checks:
 * 1. `runtime-manifest.json` is canonical-identical to the embedded manifest
 *    (fingerprint-exact — object-key order is normalised, so the materialiser's
 *    plain `JSON.stringify` write and the generator's canonical write compare
 *    equal for the same content).
 * 2. `package-lock.json` is a well-formed npm lockfile v3 document (parses as
 *    JSON with `lockfileVersion === 3` and a `packages` object). A truncated
 *    or corrupt lock fails to parse and marks the closure damaged; the lock is
 *    the provenance record the closure was reified from, so a damaged lock
 *    cannot be trusted even though the runtime does not re-read it post-activate.
 * 3. every direct dependency's installed `node_modules/<pkg>/package.json`
 *    `version` equals the manifest's pinned version. The DSH manifest pins
 *    exact versions (derived from the committed lock), so an exact string
 *    compare is the intended fingerprint semantics; a range spec would never
 *    be emitted by the generator.
 *
 * Throws on the first mismatch.
 */
function verifyClosureContent(closureDir: string, manifest: DshRuntimeManifestV1): void {
  const stored = JSON.parse(readFileSync(join(closureDir, "runtime-manifest.json"), "utf8")) as unknown
  if (canonicalSerialize(stored) !== canonicalSerialize(manifest)) {
    throw new Error("dsh runtime: closure runtime-manifest.json does not match the embedded manifest")
  }
  // Lock binding (B-03): the stored npm lockfile v3 document must canonical-equal
  // the deterministic npm v3 lock derived from the manifest's packageLock
  // (closureLockJson). This binds the whole tree — resolved tarball URLs,
  // integrity, and every transitive entry — with no per-entry logic. A
  // valid-shaped-but-different lock (empty packages map, altered integrity, an
  // extra/different entry) fails and marks the closure damaged.
  const storedLock = JSON.parse(readFileSync(join(closureDir, "package-lock.json"), "utf8")) as unknown
  const expectedLock = JSON.parse(closureLockJson(manifest)) as unknown
  if (canonicalSerialize(storedLock) !== canonicalSerialize(expectedLock)) {
    throw new Error("dsh runtime: closure package-lock.json does not match the embedded manifest lock")
  }
  for (const name of Object.keys(manifest.dependencies)) {
    const pinned = manifest.dependencies[name]
    const pkgPath = join(closureDir, "node_modules", ...name.split("/"), "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown }
    if (pkg.version !== pinned) {
      throw new Error(`dsh runtime: closure dependency "${name}" is ${String(pkg.version)}, expected ${pinned}`)
    }
  }
}

/**
 * Whether a closure directory is complete for the given manifest: manifest +
 * lock + runtime-manifest present, the `@deepseek-ai/dsh` anchor present, every
 * direct dependency installed, AND the closure content matches the embedded
 * manifest (fingerprint-exact manifest + pinned dependency versions). Used by
 * the fast-path validate and by the append-only activate guard (a damaged or
 * tampered closure must be re-materialised, DESIGN §3.4.7).
 */
function isClosureComplete(closureDir: string, manifest: DshRuntimeManifestV1): boolean {
  if (!existsSync(join(closureDir, "package.json"))) return false
  if (!existsSync(join(closureDir, "package-lock.json"))) return false
  if (!existsSync(join(closureDir, "runtime-manifest.json"))) return false
  if (!existsSync(join(closureDir, "node_modules", "@deepseek-ai", "dsh", "package.json"))) return false
  if (directDepsMissingOnDisk({ closureDir, manifest }).length > 0) return false
  try {
    verifyClosureContent(closureDir, manifest)
    return true
  } catch {
    return false
  }
}

/**
 * Verify an already-activated closure on disk (stage Inspect / fast path).
 * Returns the install anchor when the closure is complete, `null` when the
 * closure is missing or damaged (e.g. the `@deepseek-ai/dsh` anchor is gone,
 * a direct dependency is missing, or the embedded manifest is absent).
 */
export function validateClosureOnDisk(options: {
  home: string
  manifest: DshRuntimeManifestV1
  deps?: MaterializeDeps
}): string | null {
  const layout = resolveDshLayout(options.home)
  const fingerprint = options.manifest.fingerprint
  if (!fingerprint) return null
  const closureName = closureNameForFingerprint(fingerprint)
  const closureDir = join(layout.closuresDir, closureName)
  if (!isClosureComplete(closureDir, options.manifest)) return null
  return anchorFor(layout, closureName)
}

/**
 * Integrity verification (DESIGN §3.4.5 stage 6 / Out of Scope note).
 *
 * Tarball integrity is verified by Arborist during reify against the lock's
 * `integrity` metadata. The runtime's own check here is structural AND
 * content-exact — every direct dependency's package.json must be present
 * under the closure, the stored `runtime-manifest.json` must be canonical-
 * identical to the embedded manifest, and every pinned dependency version
 * must match (B-03). When the generator left an empty integrity ledger, this
 * is a no-op reported as "skipped" in diagnostics. A damaged closure is
 * signalled by throwing.
 */
export async function checkClosureIntegrity(options: {
  home: string
  manifest: DshRuntimeManifestV1
  deps?: MaterializeDeps
}): Promise<void> {
  const layout = resolveDshLayout(options.home)
  const closureName = closureNameForFingerprint(options.manifest.fingerprint ?? "")
  const closureDir = join(layout.closuresDir, closureName)
  const missing = directDepsMissingOnDisk({ closureDir, manifest: options.manifest })
  if (missing.length > 0) {
    throw new Error(
      `dsh runtime: closure integrity verification failed, missing packages: ${missing.join(", ")}`,
    )
  }
  verifyClosureContent(closureDir, options.manifest)
}
