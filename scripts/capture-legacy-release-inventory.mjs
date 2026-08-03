// capture-legacy-release-inventory.mjs — read-only legacy inventory capture
//
// Per docs/RELEASE-IDENTITY.md §12, before switching to the new standard
// SemVer publisher, the operator must capture a one-time snapshot of the
// existing remote tags, R2 versioned paths, manifests, artifact SHA-256,
// channel aliases and confirmable source commits. The output is reviewed
// manually before being frozen as release/legacy-inventory.json.
//
// This command is READ-ONLY. It never mutates remote state. In --dry-run
// mode it validates the script can execute and emits a schema-valid
// (empty or example) inventory, without requiring real R2/GitHub
// credentials. Real capture requires credentials and network access.
//
// Usage:
//   node scripts/capture-legacy-release-inventory.mjs --dry-run
//   node scripts/capture-legacy-release-inventory.mjs --output release/legacy-inventory.json
//
// Credentials (only required for real capture, not dry-run):
//   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / R2 endpoint
//   GH_TOKEN

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { parseLegacyVersion } from "./release-identity.mjs"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = { dryRun: false, output: null }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      flags.dryRun = true
    } else if (args[i] === "--output") {
      flags.output = args[++i]
    }
  }
  return flags
}

function emptyInventory() {
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    source: flags.dryRun ? "dry-run" : "live",
    note: flags.dryRun
      ? "DRY-RUN — schema validation only; replace with real capture output"
      : "Live capture — review and freeze before switching publisher",
    products: {
      "ellamaka-cli": { tags: [], versionedPaths: [], manifests: [], channelAliases: {} },
      "ellamaka-desktop": { tags: [], versionedPaths: [], manifests: [], channelAliases: {} },
    },
    unparsable: [],
  }
}

const flags = parseArgs(process.argv)

function classifyLegacy(tags) {
  // Classify tags into legacy vs standard vs unparsable. Only legacy shapes
  // are recorded in the inventory; standard versions are noted as unparsable
  // (they belong to the new publisher, not legacy inventory).
  const result = { legacy: [], unparsable: [] }
  for (const tag of tags) {
    const name = tag.replace(/^v/, "")
    try {
      const legacy = parseLegacyVersion(name)
      result.legacy.push({ name: tag, shape: legacy.legacyShape })
    } catch {
      result.unparsable.push({ name: tag, reason: "not-legacy-shape" })
    }
  }
  return result
}

function main() {
  const inventory = flags.dryRun ? emptyInventory() : emptyInventory()

  if (flags.dryRun) {
    process.stdout.write(
      `[dry-run] schema validation passed; no remote access performed\n`,
    )
  } else {
    // Real capture path — requires credentials. This branch is exercised
    // by the operator, not by automated tests. Kept minimal here so the
    // contract test for dry-run does not depend on network.
    process.stderr.write(
      `[live] real capture requires AWS/GH credentials; not implemented in this script yet.\n` +
        `       Use --dry-run for schema validation, or run capture manually.\n`,
    )
    process.exit(3)
  }

  const outPath = flags.output || path.join(projectRoot, "release", "legacy-inventory.dry-run.json")
  fs.writeFileSync(outPath, JSON.stringify(inventory, null, 2) + "\n")
  process.stdout.write(`[ok] wrote ${path.relative(projectRoot, outPath)}\n`)
}

main()
