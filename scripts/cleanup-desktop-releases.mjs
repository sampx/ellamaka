#!/usr/bin/env node

/**
 * cleanup-desktop-releases.mjs
 *
 * Protection-model cleanup for ellamaka-desktop releases. Per
 * docs/RELEASE-IDENTITY.md §9.1, this script does not use shell version
 * sort, mtime, or legacy numeric-suffix comparators. It builds a reference
 * graph (stable and beta latest aliases are protected), and only standard
 * SemVer releases within the same product/channel become retention
 * candidates. Legacy and unknown objects fail closed (retained, never
 * auto-deleted).
 *
 * Modes:
 *   retention: `--keep-prod N --keep-beta M` keeps the N newest stable and
 *     M newest beta standard-SemVer releases; deletes older non-protected
 *     standard releases; never touches legacy. Applies with a fresh re-read
 *     of aliases to skip candidates that became protected since the plan.
 *   withdraw: `--withdraw <version> --fallback <v>` performs whole-version
 *     withdrawal per §9.2. The version must be recorded in
 *     release/withdrawn-versions.json. Steps: restore aliases → delete
 *     versioned R2 path → delete GitHub/Gitee Release + tag.
 *
 * Usage:
 *   node scripts/cleanup-desktop-releases.mjs --keep-prod 3 --keep-beta 2 [--dry-run]
 *   node scripts/cleanup-desktop-releases.mjs --withdraw 1.16.0 --fallback 1.17.0 [--dry-run]
 *
 * Environment variables:
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / R2_ENDPOINT — R2 credentials
 *   GH_TOKEN    — GitHub PAT with repo scope on both wopal-cn repos
 *   GITEE_TOKEN — Gitee API token
 */

import { execSync } from "child_process";
import { compareSemVer, parseReleaseVersion, parseLegacyVersion } from "./release-identity.mjs";

// ===========================================================================
// Task 5: protection model (docs/RELEASE-IDENTITY.md §9.1)
// ===========================================================================

const PRODUCT = "ellamaka-desktop";

/**
 * @typedef {Object} ReleaseSnapshot
 * @property {string[]} versionedPaths
 * @property {string[]} tags
 */
/**
 * @typedef {Record<string, string>} AliasMap
 */
/**
 * @typedef {Object} ReferenceGraph
 * @property {Set<string>} protected
 * @property {Map<string, string>} protectedReason
 * @property {Set<string>} legacy
 * @property {Set<string>} standard
 */

export function parseReleaseTag(tag) {
  const m = tag.match(/^ellamaka-desktop-v(.+)$/);
  if (!m) return null;
  const version = m[1];
  try {
    const parsed = parseReleaseVersion(version);
    return {
      product: PRODUCT,
      version,
      channel: parsed.channel,
      kind: "standard",
    };
  } catch {
    return null;
  }
}

export function parseLegacyTag(tag) {
  if (!tag.startsWith("ellamaka-desktop-v")) return null;
  const version = tag.slice("ellamaka-desktop-v".length);
  try {
    const legacy = parseLegacyVersion(version);
    // Desktop legacy beta: X.Y.Z-beta.N (legacyShape "beta-iteration" if -N.beta.M, else standard beta retained as legacy)
    return {
      product: PRODUCT,
      version,
      kind: "legacy",
      legacyShape: legacy.legacyShape,
    };
  } catch {
    // Desktop legacy beta shape: X.Y.Z-beta.N where N is numeric (older format
    // used -beta.N). parseLegacyVersion rejects this as standard beta, but for
    // desktop cleanup we classify the ontology-tagged beta as legacy if it
    // matches the old desktop beta iteration pattern.
    if (/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) {
      return { product: PRODUCT, version, kind: "legacy", legacyShape: "beta-iteration" };
    }
    return null;
  }
}

function versionFromPath(p) {
  const m = p.match(/^ellamaka-desktop\/(?:beta\/)?v(.+)$/);
  return m ? m[1] : null;
}

function channelFromPath(p) {
  return p.includes("/beta/") ? "beta" : "stable";
}

function pathForVersion(version, channel) {
  return channel === "beta"
    ? `ellamaka-desktop/beta/v${version}`
    : `ellamaka-desktop/v${version}`;
}

export function buildReferenceGraph(snapshot, aliases) {
  const protected_ = new Set();
  const protectedReason = new Map();
  const legacy = new Set();
  const standard = new Set();

  for (const [alias, version] of Object.entries(aliases)) {
    if (!alias.includes("ellamaka-desktop") || !alias.includes("latest")) continue;
    const channel = alias.includes("/beta/") ? "beta" : "stable";
    const path = pathForVersion(version, channel);
    if (snapshot.versionedPaths.includes(path)) {
      protected_.add(path);
      protectedReason.set(path, `latest alias ${alias}`);
    }
  }

  for (const p of snapshot.versionedPaths) {
    const version = versionFromPath(p);
    if (!version) continue;
    try {
      parseReleaseVersion(version);
      standard.add(p);
      continue;
    } catch {}
    try {
      parseLegacyVersion(version);
      legacy.add(p);
      continue;
    } catch {
      legacy.add(p);
    }
  }

  return { protected: protected_, protectedReason, legacy, standard };
}

/**
 * @typedef {Object} RetentionPlan
 * @property {Array<{version: string, path: string, protected: boolean}>} deleteCandidates
 * @property {string[]} legacyRetained
 * @property {boolean} dryRun
 */

export function planRetention({
  product,
  channel,
  snapshot,
  aliases,
  keepStable,
  dryRun = false,
}) {
  const graph = buildReferenceGraph(snapshot, aliases);
  const candidates = [];
  const legacyRetained = [];

  for (const p of snapshot.versionedPaths) {
    const version = versionFromPath(p);
    if (!version) continue;
    if (graph.legacy.has(p)) {
      legacyRetained.push(version);
      continue;
    }
    if (!graph.standard.has(p)) continue;
    if (channelFromPath(p) !== channel) continue;
    try {
      const parsed = parseReleaseVersion(version);
      if (parsed.channel !== channel) continue;
    } catch {
      continue;
    }
    candidates.push({ version, path: p, protected: graph.protected.has(p) });
  }

  candidates.sort((a, b) => compareSemVer(b.version, a.version));

  const deleteCandidates = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c.protected) continue;
    if (i < keepStable) continue;
    deleteCandidates.push(c);
  }

  return { deleteCandidates, legacyRetained, dryRun };
}

/**
 * W-06: Re-validate a plan's delete candidates against a FRESH reference
 * graph right before apply. If a candidate became protected (e.g. latest
 * alias was concurrently moved to it), skip it and record a warning.
 */
export function applyRetentionWithRecheck(plan, freshGraph) {
  const kept = []
  const skipped = []
  for (const c of plan.deleteCandidates) {
    if (freshGraph.protected.has(c.path)) {
      const reason = freshGraph.protectedReason.get(c.path) ?? "protected"
      skipped.push({ ...c, reason })
      continue
    }
    kept.push(c)
  }
  return { kept, skipped }
}

/**
 * @typedef {Object} WithdrawPlan
 * @property {boolean} allowed
 * @property {string} [reason]
 * @property {Array<{action: string, target: string}>} steps
 */

export function planWithdraw({
  product,
  version,
  snapshot,
  aliases,
  withdrawn,
  fallbackVersion,
}) {
  const withdrawnList = (withdrawn?.products?.[product]) || [];
  if (!withdrawnList.includes(version)) {
    return { allowed: false, reason: `version ${version} not in withdrawn-versions.json`, steps: [] };
  }

  // Determine channel from the version.
  const channel = version.includes("-beta.") ? "beta" : "stable";
  const fallbackPath = pathForVersion(fallbackVersion, channel);
  if (!snapshot.versionedPaths.includes(fallbackPath)) {
    return { allowed: false, reason: `fallback ${fallbackVersion} not found in versioned paths`, steps: [] };
  }

  const steps = [];
  for (const [alias, aliasVersion] of Object.entries(aliases)) {
    if (aliasVersion === version) {
      steps.push({ action: "restore-alias", target: alias });
    }
  }
  steps.push({ action: "delete-versioned-path", target: pathForVersion(version, channel) });
  steps.push({ action: "delete-tag", target: `ellamaka-desktop-v${version}` });

  return { allowed: true, steps };
}

// ===========================================================================
// Execution layer: R2 / GitHub / Gitee probes + plan/apply
//
// Per Task 5 B-01: main() uses buildReferenceGraph + planRetention (NOT
// the removed parseTag/compareVersions/selectForDeletion). Legacy and
// unknown objects fail closed (retained, never auto-deleted). Whole-version
// withdrawal uses planWithdraw.
// ===========================================================================

import fs from "node:fs";

const R2_BUCKET = "wopal-release";

function listR2VersionedPaths(r2Url, r2Root) {
  const cmd = `aws s3api list-objects-v2 \
    --bucket ${R2_BUCKET} \
    --prefix "${r2Root}/" \
    --delimiter "/" \
    --endpoint-url "${r2Url}" \
    --query "CommonPrefixes[].Prefix" \
    --output json`;
  const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  const prefixes = JSON.parse(output);
  return prefixes
    .map((p) => p.replace(/\/$/, ""))
    .filter((p) => {
      const name = p.replace(r2Root + "/", "");
      return name.startsWith("v");
    });
}

function deleteR2Prefix(r2Url, versionedPath, dryRun) {
  const s3Key = `s3://${R2_BUCKET}/${versionedPath}/`;
  if (dryRun) {
    console.log(`  [DRY RUN] would delete ${s3Key}`);
    return;
  }
  execSync(`aws s3 rm "${s3Key}" --recursive --endpoint-url "${r2Url}"`, {
    stdio: "inherit",
  });
  console.log(`  deleted ${s3Key}`);
}

function readLatestAlias(r2Url, latestPrefix) {
  const cmd = `aws s3api get-object \
    --bucket ${R2_BUCKET} \
    --key "${latestPrefix}/manifest.json" \
    --endpoint-url "${r2Url}" \
    /dev/stdout 2>/dev/null`;
  try {
    const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const manifest = JSON.parse(output);
    return manifest.version;
  } catch {
    return null;
  }
}

const GH_REPO = "wopal-cn/wopal-space-ontology";
const ELLAMAKA_REPO = "wopal-cn/ellamaka";

function listGithubReleases(repo) {
  const cmd = `gh api repos/${repo}/releases --paginate --jq '[.[] | select(.tag_name | startswith("ellamaka-desktop-v"))] | .[].tag_name'`;
  const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  return output.trim().split("\n").filter(Boolean).filter((t) => t.startsWith("ellamaka-desktop-v"));
}

function deleteGithubRelease(repo, tag, dryRun) {
  if (dryRun) {
    console.log(`  [DRY RUN] would delete GitHub release + tag ${repo}:${tag}`);
    return;
  }
  const idCmd = `gh api repos/${repo}/releases/tags/${tag} --jq '.id'`;
  let releaseId;
  try {
    releaseId = execSync(idCmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    console.log(`  skip ${repo}:${tag} (release not found)`);
    return;
  }
  execSync(`gh api -X DELETE repos/${repo}/releases/${releaseId}`, { stdio: "inherit" });
  try {
    execSync(`gh api -X DELETE repos/${repo}/git/refs/tags/${tag}`, { stdio: ["pipe", "pipe", "pipe"] });
    console.log(`  deleted GitHub release + tag ${repo}:${tag}`);
  } catch {
    console.log(`  deleted GitHub release ${repo}:${tag} (tag deletion skipped — not found)`);
  }
}

const GITEE_BASE = "https://gitee.com/api/v5";

function listGiteeReleases(token, repo) {
  const [owner, repoName] = repo.split("/");
  const url = `${GITEE_BASE}/repos/${owner}/${repoName}/releases?access_token=${encodeURIComponent(token)}&per_page=100`;
  const cmd = `curl -fsSL "${url}"`;
  const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  const releases = JSON.parse(output);
  return releases
    .filter((r) => r.tag_name && r.tag_name.startsWith("ellamaka-desktop-v"))
    .map((r) => ({ id: r.id, tag_name: r.tag_name }));
}

function deleteGiteeRelease(token, repo, release, dryRun) {
  const [owner, repoName] = repo.split("/");
  if (dryRun) {
    console.log(`  [DRY RUN] would delete Gitee release + tag ${repo}:${release.tag_name} (id=${release.id})`);
    return;
  }
  const url = `${GITEE_BASE}/repos/${owner}/${repoName}/releases/${release.id}?access_token=${encodeURIComponent(token)}`;
  execSync(`curl -fsSL -X DELETE "${url}"`, { stdio: "inherit" });
  const tagUrl = `${GITEE_BASE}/repos/${owner}/${repoName}/git/refs/tags/${release.tag_name}?access_token=${encodeURIComponent(token)}`;
  try {
    execSync(`curl -fsSL -X DELETE "${tagUrl}"`, { stdio: ["pipe", "pipe", "pipe"] });
    console.log(`  deleted Gitee release + tag ${repo}:${release.tag_name} (id=${release.id})`);
  } catch {
    console.log(`  deleted Gitee release ${repo}:${release.tag_name} (id=${release.id}) (tag deletion skipped)`);
  }
}

// --- Args ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { mode: "retention", keepProd: 3, keepBeta: 2, dryRun: false, withdrawVersion: null, fallback: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--keep-prod") flags.keepProd = parseInt(args[++i], 10);
    else if (a === "--keep-beta") flags.keepBeta = parseInt(args[++i], 10);
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--withdraw") { flags.mode = "withdraw"; flags.withdrawVersion = args[++i]; }
    else if (a === "--fallback") flags.fallback = args[++i];
  }
  return flags;
}

// --- Main ---

async function main() {
  const flags = parseArgs(process.argv);
  const r2Endpoint = process.env.R2_ENDPOINT;
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const giteeToken = process.env.GITEE_TOKEN;

  if (!r2Endpoint) {
    console.error("Error: R2_ENDPOINT is required");
    process.exit(1);
  }
  if (!ghToken) {
    console.error("Error: GH_TOKEN or GITHUB_TOKEN is required");
    process.exit(1);
  }

  const r2Url = `https://${r2Endpoint}`;
  const mode = flags.dryRun ? "[DRY RUN] " : "";

  if (flags.mode === "withdraw") {
    await runWithdraw({ flags, r2Url, ghToken, giteeToken });
    return;
  }

  await runRetention({ flags, r2Url, ghToken, giteeToken, mode });
}

async function runRetention({ flags, r2Url, ghToken, giteeToken, mode }) {
  console.log(`\n${mode}Cleaning up old ellamaka-desktop releases (protection model, keep ${flags.keepProd} prod + ${flags.keepBeta} beta)\n`);

  const PROD_ROOT = "ellamaka-desktop";
  const BETA_ROOT = "ellamaka-desktop/beta";

  // 1. Build snapshot from R2 prod + beta prefixes.
  let versionedPaths = [];
  console.log("=== R2 (prod): listing versioned prefixes ===");
  try {
    const prodPaths = listR2VersionedPaths(r2Url, PROD_ROOT);
    console.log(`  found ${prodPaths.length} prod versioned prefixes`);
    versionedPaths.push(...prodPaths);
  } catch (err) {
    console.error(`  R2 prod list failed: ${err.message}`);
  }

  console.log("\n=== R2 (beta): listing versioned prefixes ===");
  try {
    const betaPaths = listR2VersionedPaths(r2Url, BETA_ROOT);
    console.log(`  found ${betaPaths.length} beta versioned prefixes`);
    versionedPaths.push(...betaPaths);
  } catch (err) {
    console.error(`  R2 beta list failed: ${err.message}`);
  }

  // 2. Read current aliases.
  const prodLatest = readLatestAlias(r2Url, `${PROD_ROOT}/latest`);
  const betaLatest = readLatestAlias(r2Url, `${BETA_ROOT}/latest`);
  const aliases = {
    ...(prodLatest ? { "ellamaka-desktop/latest/manifest.json": prodLatest } : {}),
    ...(betaLatest ? { "ellamaka-desktop/beta/latest/manifest.json": betaLatest } : {}),
  };
  console.log(`  prod latest → ${prodLatest ?? "none"}, beta latest → ${betaLatest ?? "none"}`);

  const snapshot = { versionedPaths, tags: [] };

  // 3. Plan retention for prod (stable) and beta separately.
  const allDeleteCandidates = [];
  const allLegacyRetained = new Set();
  for (const channel of ["stable", "beta"]) {
    const keep = channel === "stable" ? flags.keepProd : flags.keepBeta;
    const plan = planRetention({
      product: PRODUCT,
      channel,
      snapshot,
      aliases,
      keepStable: keep,
      dryRun: flags.dryRun,
    });
    allDeleteCandidates.push(...plan.deleteCandidates);
    for (const v of plan.legacyRetained) allLegacyRetained.add(v);
  }

  if (allLegacyRetained.size > 0) {
    console.log(`  legacy/unknown retained (fail-closed): ${[...allLegacyRetained].join(", ")}`);
  }

  // 4. W-06: re-read aliases and rebuild reference graph right before apply.
  //    Skip any candidate that became protected since the plan.
  const freshProdLatest = readLatestAlias(r2Url, `${PROD_ROOT}/latest`);
  const freshBetaLatest = readLatestAlias(r2Url, `${BETA_ROOT}/latest`);
  const freshAliases = {
    ...(freshProdLatest ? { "ellamaka-desktop/latest/manifest.json": freshProdLatest } : {}),
    ...(freshBetaLatest ? { "ellamaka-desktop/beta/latest/manifest.json": freshBetaLatest } : {}),
  };
  const freshGraph = buildReferenceGraph(snapshot, freshAliases);
  const provisionalPlan = { deleteCandidates: allDeleteCandidates };
  const { kept, skipped } = applyRetentionWithRecheck(provisionalPlan, freshGraph);
  if (skipped.length > 0) {
    console.log(`  ${skipped.length} candidate(s) skipped (became protected since plan):`);
    for (const s of skipped) {
      console.log(`    skip ${s.path} — ${s.reason}`);
    }
  }

  const allDeleteVersions = new Set();
  if (kept.length > 0) {
    console.log(`  deleting ${kept.length} R2 prefixes:`);
    for (const c of kept) {
      try {
        deleteR2Prefix(r2Url, c.path, flags.dryRun);
        allDeleteVersions.add(c.version);
      } catch (err) {
        console.error(`  failed to delete ${c.path}: ${err.message}`);
      }
    }
  }

  // 5. GitHub + Gitee release pages: delete matching tags.
  if (allDeleteVersions.size > 0) {
    console.log(`\n=== GitHub (${ELLAMAKA_REPO}): matching ellamaka-desktop-v* releases ===`);
    try {
      const ghTags = listGithubReleases(ELLAMAKA_REPO);
      for (const tag of ghTags) {
        const parsed = parseReleaseTag(tag);
        if (parsed && allDeleteVersions.has(parsed.version)) {
          deleteGithubRelease(ELLAMAKA_REPO, tag, flags.dryRun);
        }
      }
    } catch (err) {
      console.error(`  GitHub list failed: ${err.message}`);
    }

    if (giteeToken) {
      console.log(`\n=== Gitee (${ELLAMAKA_REPO}): matching ellamaka-desktop-v* releases ===`);
      try {
        const giteeReleases = listGiteeReleases(giteeToken, ELLAMAKA_REPO);
        for (const release of giteeReleases) {
          const parsed = parseReleaseTag(release.tag_name);
          if (parsed && allDeleteVersions.has(parsed.version)) {
            deleteGiteeRelease(giteeToken, ELLAMAKA_REPO, release, flags.dryRun);
          }
        }
      } catch (err) {
        console.error(`  Gitee list failed: ${err.message}`);
      }
    }
  }

  console.log(`\n${mode}Cleanup complete.\n`);
}

async function runWithdraw({ flags, r2Url, ghToken, giteeToken }) {
  if (!flags.withdrawVersion) {
    console.error("Error: --withdraw requires a version argument");
    process.exit(2);
  }
  if (!flags.fallback) {
    console.error("Error: --withdraw requires --fallback <version>");
    process.exit(2);
  }

  console.log(`\nWithdrawing ellamaka-desktop v${flags.withdrawVersion} (fallback: ${flags.fallback})\n`);

  const withdrawn = JSON.parse(fs.readFileSync("release/withdrawn-versions.json", "utf8"));

  const PROD_ROOT = "ellamaka-desktop";
  const BETA_ROOT = "ellamaka-desktop/beta";
  const channel = flags.withdrawVersion.includes("-beta.") ? "beta" : "stable";
  const r2Root = channel === "beta" ? BETA_ROOT : PROD_ROOT;

  let versionedPaths = [];
  try {
    versionedPaths = listR2VersionedPaths(r2Url, r2Root);
  } catch (err) {
    console.error(`  R2 list failed: ${err.message}`);
  }

  const latestPrefix = `${r2Root}/latest`;
  const latestVersion = readLatestAlias(r2Url, latestPrefix);
  const aliases = latestVersion ? { [`${latestPrefix}/manifest.json`]: latestVersion } : {};
  const snapshot = { versionedPaths, tags: [] };

  const plan = planWithdraw({
    product: PRODUCT,
    version: flags.withdrawVersion,
    snapshot,
    aliases,
    withdrawn,
    fallbackVersion: flags.fallback,
  });

  if (!plan.allowed) {
    console.error(`Error: withdrawal denied: ${plan.reason}`);
    process.exit(1);
  }

  console.log(`Plan: ${plan.steps.length} steps`);
  for (const step of plan.steps) {
    console.log(`  ${step.action}: ${step.target}`);
  }

  if (flags.dryRun) {
    console.log("\n[DRY RUN] no mutations performed.");
    return;
  }

  for (const step of plan.steps) {
    if (step.action === "restore-alias") {
      console.log(`  restoring alias ${step.target} → ${flags.fallback}`);
      const fallbackManifestKey = `${r2Root}/v${flags.fallback}/manifest.json`;
      execSync(
        `aws s3 cp "s3://${R2_BUCKET}/${fallbackManifestKey}" "s3://${R2_BUCKET}/${step.target}" --endpoint-url "${r2Url}"`,
        { stdio: "inherit" },
      );
    } else if (step.action === "delete-versioned-path") {
      deleteR2Prefix(r2Url, step.target, false);
    } else if (step.action === "delete-tag") {
      try {
        deleteGithubRelease(ELLAMAKA_REPO, step.target, false);
      } catch (err) {
        console.error(`  failed to delete tag on GitHub: ${err.message}`);
      }
      if (giteeToken) {
        try {
          const giteeReleases = listGiteeReleases(giteeToken, ELLAMAKA_REPO);
          const match = giteeReleases.find((r) => r.tag_name === step.target);
          if (match) deleteGiteeRelease(giteeToken, ELLAMAKA_REPO, match, false);
        } catch (err) {
          console.error(`  Gitee tag delete failed: ${err.message}`);
        }
      }
    }
  }

  console.log("  CDN purge of restored alias is operator's responsibility (run purge separately).");
  console.log(`\nWithdrawal of v${flags.withdrawVersion} complete.\n`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly && !process.env.VITEST) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
