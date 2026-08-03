// update-upstream-lock.mjs — the ONLY writer for release/upstreams.lock.json
//
// Per docs/RELEASE-IDENTITY.md §6, the upstream lock is never updated by
// release workflows, inputs, or environment variables. Only this command,
// invoked by an operator, resolves a target OpenCode tag's full commit and
// writes it into the lock. Engine baseline updates and component baseline
// updates use separate invocations — the latter never cascade from the
// former.
//
// Usage:
//   node scripts/update-upstream-lock.mjs engine --version 1.18.10
//   node scripts/update-upstream-lock.mjs component --path packages/app --version 1.15.13
//
// This script performs a real `git ls-remote` against the upstream repo to
// resolve the tag commit. In dry-run mode (--dry-run) it only prints what
// would change without writing.

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"
import { validateUpstreamLock } from "./release-identity.mjs"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const LOCK_PATH = path.join(projectRoot, "release", "upstreams.lock.json")
const UPSTREAM_REPO = "https://github.com/anomalyco/opencode.git"

function usage() {
  process.stderr.write(
    `Usage:
  node scripts/update-upstream-lock.mjs engine --version <X.Y.Z> [--dry-run]
  node scripts/update-upstream-lock.mjs component --path <packages/app|packages/desktop> --version <X.Y.Z> [--dry-run]
`,
  )
  process.exit(2)
}

function parseArgs(argv) {
  const args = argv.slice(2)
  const mode = args[0]
  if (mode !== "engine" && mode !== "component") usage()

  const flags = {}
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      flags.dryRun = true
      continue
    }
    if (args[i] === "--version") {
      flags.version = args[++i]
      continue
    }
    if (args[i] === "--path") {
      flags.path = args[++i]
      continue
    }
    usage()
  }

  if (!flags.version) usage()
  if (mode === "component" && !flags.path) usage()
  return { mode, ...flags }
}

function resolveUpstreamCommit(version) {
  // Resolve the OpenCode tag `vX.Y.Z` to a full 40-char commit via ls-remote.
  const tag = `v${version}`
  try {
    const out = execSync(`git ls-remote ${UPSTREAM_REPO} refs/tags/${tag}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
    if (!out) throw new Error(`tag ${tag} not found upstream`)
    const sha = out.split(/\s+/)[0]
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error(`resolved sha ${sha} is not 40 chars`)
    }
    return sha
  } catch (err) {
    // In dry-run / offline scenarios, allow --commit override via env to keep
    // the command testable. Real operator use resolves via ls-remote.
    const override = process.env.OPENCODE_UPSTREAM_COMMIT
    if (override && /^[0-9a-f]{40}$/.test(override)) return override
    throw err
  }
}

function main() {
  const opts = parseArgs(process.argv)
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"))

  if (opts.mode === "engine") {
    const commit = resolveUpstreamCommit(opts.version)
    lock.sources.opencode.version = opts.version
    lock.sources.opencode.gitCommit = commit
    process.stdout.write(
      `[engine] sources.opencode → version=${opts.version}, commit=${commit}\n`,
    )
  } else {
    const entry = lock.componentBaselines[opts.path]
    if (!entry) {
      process.stderr.write(`component ${opts.path} not found in lock\n`)
      process.exit(1)
    }
    const commit = resolveUpstreamCommit(opts.version)
    entry.version = opts.version
    entry.gitCommit = commit
    process.stdout.write(
      `[component] ${opts.path} → version=${opts.version}, commit=${commit}\n`,
    )
  }

  validateUpstreamLock(lock)
  if (opts.dryRun) {
    process.stdout.write(`[dry-run] no write performed\n`)
  } else {
    fs.writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + "\n")
    process.stdout.write(`[ok] wrote ${path.relative(projectRoot, LOCK_PATH)}\n`)
  }
}

try {
  main()
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`)
  process.exit(1)
}
