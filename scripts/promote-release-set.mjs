// promote-release-set.mjs — independent release-set coordinator
//
// Per docs/RELEASE-IDENTITY.md §11, when a CLI/Desktop baseline change
// requires both products to move, each product publish workflow only
// commits its own immutable versioned release. This coordinator reads
// already-committed versioned manifests, validates the final alias set,
// and promotes aliases in a resumable, idempotent order.
//
// Modes:
//   plan:  fetch specified versioned manifests + current aliases, output
//          buildPromotionPlan result and validatePromotionSet conclusion.
//          Exits non-zero if validation fails.
//   apply: execute the plan step by step, writing each alias to R2, re-
//          reading current aliases before each mutation to skip already-
//          completed steps (idempotent). Records completed steps on failure.
//
// Usage:
//   node scripts/promote-release-set.mjs plan \
//     --cli-version 1.17.1 \
//     --desktop-stable-version 1.16.2 \
//     [--desktop-beta-version 1.17.0-beta.1]
//   node scripts/promote-release-set.mjs apply \
//     --cli-version 1.17.1 --desktop-stable-version 1.16.2
//
// Environment (apply mode):
//   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / R2_ENDPOINT

import { execSync } from "child_process"

const R2_BUCKET = "wopal-release"
const CDN_BASE = "https://download.coursedao.com"

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
      manifestUrl: `${CDN_BASE}/ellamaka/v${cliManifest.releaseIdentity.version}/manifest.json`,
    })
  }

  if (desktopStableManifest) {
    steps.push({
      alias: "ellamaka-desktop/latest/manifest.json",
      product: "ellamaka-desktop",
      channel: "stable",
      targetVersion: desktopStableManifest.releaseIdentity.version,
      manifestUrl: `${CDN_BASE}/ellamaka-desktop/v${desktopStableManifest.releaseIdentity.version}/manifest.json`,
    })
  }

  if (desktopBetaManifest) {
    steps.push({
      alias: "ellamaka-desktop/beta/latest/manifest.json",
      product: "ellamaka-desktop",
      channel: "beta",
      targetVersion: desktopBetaManifest.releaseIdentity.version,
      manifestUrl: `${CDN_BASE}/ellamaka-desktop/beta/v${desktopBetaManifest.releaseIdentity.version}/manifest.json`,
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
 * coordinator validates the FINAL alias set, not the diff. This includes
 * the engineApi SemVer range check (the Desktop runtime gate is a
 * defense-in-depth second check; the coordinator is the first).
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
  // engineApi SemVer range check (§7.1 item 4). The CLI manifest carries
  // capabilities.engineApi; the Desktop manifest declares the range.
  const cliEngineApi = cliManifest.capabilities?.engineApi
  if (cliEngineApi && req.engineApi) {
    if (!satisfiesRange(cliEngineApi, req.engineApi)) {
      return { compatible: false, reason: `engineApi ${cliEngineApi} does not satisfy ${req.engineApi}` }
    }
  }
  return { compatible: true }
}

// Minimal SemVer range checker: supports ">=X.Y.Z <A.B.C" and ">=X.Y.Z".
function satisfiesRange(version, range) {
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

export { satisfiesRange }

// ---------------------------------------------------------------------------
// Execution layer (plan / apply)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = { mode: args[0], cliVersion: null, desktopStableVersion: null, desktopBetaVersion: null }
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--cli-version") flags.cliVersion = args[++i]
    else if (args[i] === "--desktop-stable-version") flags.desktopStableVersion = args[++i]
    else if (args[i] === "--desktop-beta-version") flags.desktopBetaVersion = args[++i]
  }
  return flags
}

export { parseArgs }

async function fetchManifest(url) {
  const output = execSync(`curl -fsSL "${url}"`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
  return JSON.parse(output)
}

function readCurrentAlias(r2Url, aliasKey) {
  const cmd = `aws s3api get-object \
    --bucket ${R2_BUCKET} \
    --key "${aliasKey}" \
    --endpoint-url "${r2Url}" \
    /dev/stdout 2>/dev/null`
  try {
    const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
    const manifest = JSON.parse(output)
    return manifest.releaseIdentity?.version ?? manifest.version ?? null
  } catch {
    return null
  }
}

function writeAlias(r2Url, aliasKey, manifestUrl) {
  // Copy the versioned manifest to the alias key.
  // Parse the manifest URL to derive the source R2 key.
  const sourceKey = manifestUrl.replace(`${CDN_BASE}/`, "")
  execSync(
    `aws s3 cp "s3://${R2_BUCKET}/${sourceKey}" "s3://${R2_BUCKET}/${aliasKey}" --endpoint-url "${r2Url}"`,
    { stdio: "inherit" },
  )
}

async function runPlan(opts) {
  const r2Endpoint = process.env.R2_ENDPOINT
  if (!r2Endpoint) {
    process.stderr.write("Error: R2_ENDPOINT is required to read current aliases\n")
    process.exit(1)
  }
  const r2Url = `https://${r2Endpoint}`

  const cliManifest = opts.cliVersion
    ? await fetchManifest(`${CDN_BASE}/ellamaka/v${opts.cliVersion}/manifest.json`)
    : null
  const desktopStableManifest = opts.desktopStableVersion
    ? await fetchManifest(`${CDN_BASE}/ellamaka-desktop/v${opts.desktopStableVersion}/manifest.json`)
    : null
  const desktopBetaManifest = opts.desktopBetaVersion
    ? await fetchManifest(`${CDN_BASE}/ellamaka-desktop/beta/v${opts.desktopBetaVersion}/manifest.json`)
    : null

  const currentAliases = {
    "ellamaka/latest/manifest.json": readCurrentAlias(r2Url, "ellamaka/latest/manifest.json"),
    "ellamaka-desktop/latest/manifest.json": readCurrentAlias(r2Url, "ellamaka-desktop/latest/manifest.json"),
    "ellamaka-desktop/beta/latest/manifest.json": readCurrentAlias(r2Url, "ellamaka-desktop/beta/latest/manifest.json"),
  }
  // Remove null aliases (no current alias).
  for (const k of Object.keys(currentAliases)) {
    if (currentAliases[k] === null) delete currentAliases[k]
  }

  const validation = validatePromotionSet({ cliManifest, desktopStableManifest, desktopBetaManifest })
  if (!validation.valid) {
    process.stderr.write("Validation failed:\n")
    for (const e of validation.errors) process.stderr.write(`  - ${e}\n`)
    process.exit(1)
  }

  const plan = buildPromotionPlan({ cliManifest, desktopStableManifest, desktopBetaManifest, currentAliases })
  process.stdout.write(JSON.stringify({ validation: { valid: true }, plan }, null, 2) + "\n")
}

async function runApply(opts) {
  const r2Endpoint = process.env.R2_ENDPOINT
  if (!r2Endpoint) {
    process.stderr.write("Error: R2_ENDPOINT is required for apply\n")
    process.exit(1)
  }
  const r2Url = `https://${r2Endpoint}`

  // Reuse runPlan logic to build the plan (validation + steps).
  const cliManifest = opts.cliVersion
    ? await fetchManifest(`${CDN_BASE}/ellamaka/v${opts.cliVersion}/manifest.json`)
    : null
  const desktopStableManifest = opts.desktopStableVersion
    ? await fetchManifest(`${CDN_BASE}/ellamaka-desktop/v${opts.desktopStableVersion}/manifest.json`)
    : null
  const desktopBetaManifest = opts.desktopBetaVersion
    ? await fetchManifest(`${CDN_BASE}/ellamaka-desktop/beta/v${opts.desktopBetaVersion}/manifest.json`)
    : null

  const validation = validatePromotionSet({ cliManifest, desktopStableManifest, desktopBetaManifest })
  if (!validation.valid) {
    process.stderr.write("Validation failed, aborting apply:\n")
    for (const e of validation.errors) process.stderr.write(`  - ${e}\n`)
    process.exit(1)
  }

  // Read current aliases fresh and build the plan.
  let currentAliases = {
    "ellamaka/latest/manifest.json": readCurrentAlias(r2Url, "ellamaka/latest/manifest.json"),
    "ellamaka-desktop/latest/manifest.json": readCurrentAlias(r2Url, "ellamaka-desktop/latest/manifest.json"),
    "ellamaka-desktop/beta/latest/manifest.json": readCurrentAlias(r2Url, "ellamaka-desktop/beta/latest/manifest.json"),
  }
  for (const k of Object.keys(currentAliases)) {
    if (currentAliases[k] === null) delete currentAliases[k]
  }
  let plan = buildPromotionPlan({ cliManifest, desktopStableManifest, desktopBetaManifest, currentAliases })

  const completed = []
  for (const step of plan.steps) {
    // Re-read current alias before each mutation (idempotent skip).
    const currentNow = readCurrentAlias(r2Url, step.alias)
    if (currentNow === step.targetVersion) {
      console.log(`  [skip] ${step.alias} already at ${step.targetVersion}`)
      completed.push(step.alias)
      continue
    }
    try {
      console.log(`  [apply] ${step.alias} → ${step.targetVersion}`)
      writeAlias(r2Url, step.alias, step.manifestUrl)
      // Read back to verify.
      const readback = readCurrentAlias(r2Url, step.alias)
      if (readback !== step.targetVersion) {
        throw new Error(`readback mismatch: ${readback} != ${step.targetVersion}`)
      }
      completed.push(step.alias)
    } catch (err) {
      process.stderr.write(`ERROR applying ${step.alias}: ${err.message}\n`)
      process.stderr.write(`Completed steps: ${JSON.stringify(completed)}\n`)
      process.exit(1)
    }
  }
  console.log(`Promotion complete. ${completed.length} aliases updated.`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs(process.argv)
  if (opts.mode !== "plan" && opts.mode !== "apply") {
    process.stderr.write("Usage: promote-release-set.mjs plan|apply --cli-version X [--desktop-stable-version Y] [--desktop-beta-version Z]\n")
    process.exit(2)
  }
  if (!opts.cliVersion) {
    process.stderr.write("Error: --cli-version is required\n")
    process.exit(2)
  }
  try {
    if (opts.mode === "plan") {
      await runPlan(opts)
    } else {
      await runApply(opts)
    }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`)
    process.exit(1)
  }
}