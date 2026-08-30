/**
 * Generate `generated/dsh-runtime-manifest.json` from the DSH official direct
 * dependencies declared in this package's package.json plus the workspace lock
 * file (bun.lock).
 *
 *   bun packages/ellamaka-cordis/script/generate-dsh-runtime-manifest.ts
 *   bun packages/ellamaka-cordis/script/generate-dsh-runtime-manifest.ts --check
 *
 * Default: write the generated manifest. `--check`: compare the in-repo
 * `generated/dsh-runtime-manifest.json` against freshly computed output and
 * exit non-zero on mismatch (drift guard for CI/release gate), without writing.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildDshRuntimeManifest,
  canonicalSerialize,
  type DshRuntimeManifestV1,
} from "../src/runtime/manifest.ts"

// Locate the package root (two levels up from this script) regardless of cwd.
const scriptDir = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(scriptDir, "..")
const manifestPath = join(pkgRoot, "generated", "dsh-runtime-manifest.json")
const outputDir = dirname(manifestPath)

const args = process.argv.slice(2)
const checkOnly = args.includes("--check")

function fatal(message: string): never {
  process.stderr.write(`error: ${message}\n`)
  process.exit(1)
}

function readJson(path: string): unknown {
  if (!existsSync(path)) {
    fatal(`input file not found: ${path}`)
  }
  const raw = readFileSync(path, "utf8")
  try {
    return JSON.parse(raw)
  } catch (error) {
    fatal(`failed to parse ${path}: ${(error as Error).message}`)
  }
}

/**
 * bun.lock is written with trailing commas, which plain JSON.parse rejects.
 * Strip trailing commas before object/array closing braces so it becomes strict JSON.
 */
function readLock(path: string): unknown {
  if (!existsSync(path)) {
    fatal(`lock file not found: ${path}`)
  }
  const raw = readFileSync(path, "utf8")
  const cleaned = raw.replace(/,(\s*[}\]])/g, "$1")
  try {
    return JSON.parse(cleaned)
  } catch (error) {
    fatal(`failed to parse lock file ${path}: ${(error as Error).message}`)
  }
}

const pkg = readJson(join(pkgRoot, "package.json")) as {
  dependencies?: Record<string, string>
}
const lock = readLock(join(pkgRoot, "..", "..", "bun.lock")) as {
  lockfileVersion: number
  packages: Record<string, unknown>
}

const deps = pkg.dependencies ?? {}
if (!("@deepseek-ai/dsh" in deps)) {
  fatal(
    'package.json dependencies must declare "@deepseek-ai/dsh" as the DSH official runtime direct dependency',
  )
}

const manifest: DshRuntimeManifestV1 = buildDshRuntimeManifest(
  { dependencies: deps },
  { lockfileVersion: lock.lockfileVersion, packages: lock.packages },
)

const output = `${canonicalSerialize(manifest)}\n`

if (checkOnly) {
  if (!existsSync(manifestPath)) {
    fatal(`--check: generated manifest missing at ${manifestPath}`)
  }
  const existing = readFileSync(manifestPath, "utf8")
  if (existing !== output) {
    fatal(
      `--check: generated manifest at ${manifestPath} is out of date; re-run the generator`,
    )
  }
  process.stdout.write(`ok: ${manifestPath} is up to date (fingerprint ${manifest.fingerprint})\n`)
  process.exit(0)
}

if (!existsSync(outputDir)) {
  // generated/ is tracked; create only when missing in a fresh checkout
  const { mkdirSync } = await import("node:fs")
  mkdirSync(outputDir, { recursive: true })
}
writeFileSync(manifestPath, output)
process.stdout.write(`wrote ${manifestPath} (fingerprint ${manifest.fingerprint})\n`)
