/**
 * Generate `generated/dsh-runtime-lock.json` from the DSH runtime manifest.
 *
 *   bun packages/ellamaka-cordis/script/generate-dsh-runtime-lock.ts
 *   bun packages/ellamaka-cordis/script/generate-dsh-runtime-lock.ts --check
 *
 * `--check`: compare the in-repo lock against the current manifest and exit
 * non-zero on drift (drift guard for CI/release gate), without writing.
 *
 * The lock is the complete transitive dependency tree resolved from the
 * manifest's exact direct dependency versions. It is produced at BUILD time
 * (source environment, where Arborist is reliable) and embedded into the CLI
 * binary and Desktop sidecar. At runtime the materialiser reads the embedded
 * lock and downloads each package with `pacote` — it never resolves the tree
 * itself (SEA single-file binaries cannot run Arborist's tree solver).
 *
 * Fast path: when the in-repo lock already binds the current manifest
 * fingerprint, nothing is re-resolved (regeneration costs minutes of registry
 * metadata resolution and only happens after a dependency version bump).
 *
 * The lock carries only the `packages` table of the resolved npm lockfile v3
 * tree: each entry maps a `node_modules/...` path (including nested entries
 * carrying a different version of the same package) to its exact version. The
 * runtime registry is chosen dynamically, so the lock stores no registry URL
 * (the registry is a transport channel, not a version truth source — DESIGN
 * §3.4.3).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Arborist } from "@npmcli/arborist"
import { parseDshRuntimeManifest } from "../src/runtime/manifest.ts"
import { DSH_RUNTIME_LOCK_SCHEMA, type DshRuntimeLockV1 } from "../src/runtime/lockfile.ts"

// Locate the package root (two levels up from this script) regardless of cwd.
const scriptDir = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(scriptDir, "..")
const manifestPath = join(pkgRoot, "generated", "dsh-runtime-manifest.json")
const lockPath = join(pkgRoot, "generated", "dsh-runtime-lock.json")

const args = process.argv.slice(2)
const checkOnly = args.includes("--check")

function fatal(message: string): never {
  process.stderr.write(`error: ${message}\n`)
  process.exit(1)
}

if (!existsSync(manifestPath)) {
  fatal(`manifest not found at ${manifestPath}; run generate-dsh-runtime-manifest.ts first`)
}
const manifest = parseDshRuntimeManifest(readFileSync(manifestPath, "utf8"))

/** Read the in-repo lock, or `null` when missing/malformed. */
function readExistingLock(): DshRuntimeLockV1 | null {
  if (!existsSync(lockPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<DshRuntimeLockV1>
    if (parsed.schema !== DSH_RUNTIME_LOCK_SCHEMA || !parsed.manifestFingerprint || !parsed.packages) {
      return null
    }
    return parsed as DshRuntimeLockV1
  } catch {
    return null
  }
}

/** Resolve the full transitive tree with Arborist in a throwaway staging dir. */
async function resolveLock(): Promise<Record<string, { version: string }>> {
  const staging = mkdtempSync(join(tmpdir(), "dsh-lock-"))
  process.stdout.write(`resolving the full dependency tree (~several minutes, one-off per version bump)...\n`)
  try {
    writeFileSync(
      join(staging, "package.json"),
      JSON.stringify({ name: "ellamaka-dsh-closure", private: true, dependencies: manifest.dependencies }),
    )
    const arborist = new Arborist({
      path: staging,
      binLinks: false,
      progress: false,
      ignoreScripts: true,
      savePrefix: "",
      force: true,
    })
    // `reify` is the only tree-solving path proven to complete against the DSH
    // tree; it also downloads tarballs, which the npm cacache makes cheap on
    // repeat runs. The staged package-lock.json IS the resolved tree.
    await arborist.reify({ save: true, saveType: "prod" })
    const lock = JSON.parse(readFileSync(join(staging, "package-lock.json"), "utf8")) as {
      packages?: Record<string, { version?: unknown }>
    }
    const packages = lock.packages ?? {}
    const out: Record<string, { version: string }> = {}
    for (const [path, entry] of Object.entries(packages)) {
      if (path === "") continue // the root entry carries no version
      if (typeof entry.version !== "string") continue
      out[path] = { version: entry.version }
    }
    return out
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

if (checkOnly) {
  // Drift gate: the lock must exist and bind the current manifest fingerprint.
  const existing = readExistingLock()
  if (existing === null) {
    fatal(`--check: generated lock missing or malformed at ${lockPath}; run the generator`)
  }
  if (existing.manifestFingerprint !== manifest.fingerprint) {
    fatal(
      `--check: generated lock at ${lockPath} binds ${existing.manifestFingerprint} but the manifest is ${manifest.fingerprint}; re-run the generator`,
    )
  }
  process.stdout.write(
    `ok: ${lockPath} is up to date (${Object.keys(existing.packages).length} packages, fingerprint match)\n`,
  )
  process.exit(0)
}

// Fast path: an in-repo lock that already binds the current fingerprint is
// reused as-is — no re-resolution, the run finishes in milliseconds.
const existing = readExistingLock()
if (existing && existing.manifestFingerprint === manifest.fingerprint) {
  process.stdout.write(
    `ok: ${lockPath} already binds the current manifest (${Object.keys(existing.packages).length} packages) — nothing to do\n`,
  )
  process.exit(0)
}

const packages = await resolveLock()
const output = `${JSON.stringify(
  {
    schema: DSH_RUNTIME_LOCK_SCHEMA,
    manifestFingerprint: manifest.fingerprint,
    packages,
  },
  null,
  2,
)}\n`

writeFileSync(lockPath, output)
process.stdout.write(`wrote ${lockPath} (${Object.keys(packages).length} packages)\n`)