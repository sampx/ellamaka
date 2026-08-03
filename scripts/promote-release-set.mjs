// promote-release-set.mjs — independent release-set coordinator
//
// Per docs/RELEASE-IDENTITY.md §11, when a CLI/Desktop baseline change
// requires both products to move, each product publish workflow only
// commits its own immutable versioned release. This coordinator reads
// already-committed versioned manifests, validates the final alias set,
// and promotes aliases in a resumable, idempotent order.
//
// Usage:
//   node scripts/promote-release-set.mjs plan \
//     --cli-version 1.17.1 \
//     --desktop-stable-version 1.16.2 \
//     [--desktop-beta-version 1.17.0-beta.1]
//
// The plan subcommand reads the specified versioned manifests (via fetch
// helpers injected by the workflow) and outputs a promotion plan. The
// apply subcommand executes the plan step by step, re-reading current
// aliases before each mutation.

import { compareSemVer } from "./release-identity.mjs"

/**
 * Build a promotion plan from already-committed versioned manifests.
 * Pure function — no network I/O. The caller provides the fetched
 * manifests and current aliases.
 */
export function buildPromotionPlan({
  cliManifest,
  desktopStableManifest,
  desktopBetaManifest,
  currentAliases,
}) {
  const steps = []

  if (cliManifest) {
    steps.push({
      alias: "ellamaka/latest/manifest.json",
      product: "ellamaka-cli",
      channel: "stable",
      targetVersion: cliManifest.releaseIdentity.version,
      manifestUrl: `https://download.coursedao.com/ellamaka/v${cliManifest.releaseIdentity.version}/manifest.json`,
    })
  }

  if (desktopStableManifest) {
    steps.push({
      alias: "ellamaka-desktop/latest/manifest.json",
      product: "ellamaka-desktop",
      channel: "stable",
      targetVersion: desktopStableManifest.releaseIdentity.version,
      manifestUrl: `https://download.coursedao.com/ellamaka-desktop/v${desktopStableManifest.releaseIdentity.version}/manifest.json`,
    })
  }

  if (desktopBetaManifest) {
    steps.push({
      alias: "ellamaka-desktop/beta/latest/manifest.json",
      product: "ellamaka-desktop",
      channel: "beta",
      targetVersion: desktopBetaManifest.releaseIdentity.version,
      manifestUrl: `https://download.coursedao.com/ellamaka-desktop/beta/v${desktopBetaManifest.releaseIdentity.version}/manifest.json`,
    })
  }

  // Mark already-completed steps (idempotent retry).
  for (const step of steps) {
    const current = currentAliases[step.alias]
    step.alreadyDone = current === step.targetVersion
  }

  return { steps }
}

/**
 * Validate that a promotion set is internally compatible. Per §11, the
 * coordinator validates the FINAL alias set, not the diff.
 */
export function validatePromotionSet({ cliManifest, desktopStableManifest, desktopBetaManifest }) {
  const errors = []

  if (desktopStableManifest && cliManifest) {
    const result = checkCliDesktopCompat(cliManifest, desktopStableManifest)
    if (!result.compatible) errors.push(`desktop-stable: ${result.reason}`)
  }
  if (desktopBetaManifest && cliManifest) {
    const result = checkCliDesktopCompat(cliManifest, desktopBetaManifest)
    if (!result.compatible) errors.push(`desktop-beta: ${result.reason}`)
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}

function checkCliDesktopCompat(cliManifest, desktopManifest) {
  const req = desktopManifest.requirements?.externalCli
  if (!req) return { compatible: true }
  const cliId = cliManifest.releaseIdentity
  if (cliId.product !== req.product) {
    return { compatible: false, reason: `product ${cliId.product} != ${req.product}` }
  }
  if (cliId.channel !== req.channel) {
    return { compatible: false, reason: `channel ${cliId.channel} != ${req.channel}` }
  }
  if (req.upstreamBaseline !== undefined && cliId.upstream?.version !== req.upstreamBaseline) {
    return {
      compatible: false,
      reason: `upstream ${cliId.upstream?.version} != ${req.upstreamBaseline}`,
    }
  }
  // engineApi range check is delegated to the Desktop runtime gate; the
  // coordinator only checks structural compatibility here.
  return { compatible: true }
}

function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = { mode: args[0] }
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--cli-version") flags.cliVersion = args[++i]
    else if (args[i] === "--desktop-stable-version") flags.desktopStableVersion = args[++i]
    else if (args[i] === "--desktop-beta-version") flags.desktopBetaVersion = args[++i]
  }
  return flags
}

export { parseArgs }

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs(process.argv)
  if (opts.mode !== "plan" && opts.mode !== "apply") {
    process.stderr.write("Usage: promote-release-set.mjs plan|apply --cli-version X [--desktop-stable-version Y] [--desktop-beta-version Z]\n")
    process.exit(2)
  }
  // The actual apply requires R2 credentials and is executed in the
  // workflow. This CLI entry point only validates args.
  process.stdout.write(
    JSON.stringify({ mode: opts.mode, cliVersion: opts.cliVersion, desktopStableVersion: opts.desktopStableVersion, desktopBetaVersion: opts.desktopBetaVersion }, null, 2) + "\n",
  )
}
