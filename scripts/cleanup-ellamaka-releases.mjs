#!/usr/bin/env node

/**
 * cleanup-ellamaka-releases.mjs
 *
 * Protection-model cleanup for ellamaka CLI releases. Per
 * docs/RELEASE-IDENTITY.md §9.1, this script does not use shell version
 * sort, mtime, or the legacy X.Y.Z-N numeric-suffix comparator. It builds a
 * reference graph (latest aliases are protected), and only standard SemVer
 * releases within the same product/channel become retention candidates.
 * Legacy and unknown objects fail closed (retained, never auto-deleted).
 *
 * Modes:
 *   retention: `--keep N` keeps the N newest stable standard-SemVer
 *     releases; deletes older non-protected standard releases; never
 *     touches legacy. Applies with a fresh re-read of aliases to skip
 *     candidates that became protected since the plan.
 *   withdraw: `--withdraw <version> --fallback <v>` performs whole-version
 *     withdrawal per §9.2. The version must be recorded in
 *     release/withdrawn-versions.json. Steps: restore aliases → delete
 *     versioned R2 path → delete GitHub/Gitee Release + tag.
 *
 * Usage:
 *   node scripts/cleanup-ellamaka-releases.mjs --keep 5 [--dry-run]
 *   node scripts/cleanup-ellamaka-releases.mjs --withdraw 1.16.0 --fallback 1.17.0 [--dry-run]
 *
 * Environment variables:
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / R2_ENDPOINT — R2 credentials
 *   GH_TOKEN    — GitHub PAT with repo scope on both repos
 *   GITEE_TOKEN — Gitee API token
 */

import { execSync } from "child_process";
import fs from "fs";
import { compareSemVer, parseReleaseVersion, parseLegacyVersion } from "./release-identity.mjs";

// ===========================================================================
// Task 5: protection model (docs/RELEASE-IDENTITY.md §9.1)
//
// cleanup must NOT use shell version sort, mtime, or the legacy X.Y.Z-N numeric-suffix
// comparator. It builds a reference graph (latest + updater aliases are
// protected), and only standard SemVer releases within the same
// product/channel become retention candidates. Legacy/unknown objects fail
// closed (retained, never auto-deleted).
// ===========================================================================

const PRODUCT = "ellamaka-cli";

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

/**
 * Parse a namespaced standard SemVer tag for ellamaka-cli. Returns null for
 * non-CLI tags, generic vX.Y.Z tags, or legacy shapes.
 */
export function parseReleaseTag(tag) {
  const m = tag.match(/^ellamaka-cli-v(.+)$/);
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

/**
 * Parse a legacy tag (X.Y.Z-N or X.Y.Z-N.rcM) for ellamaka-cli. Accepts
 * both bare `v1.15.13-4` and ontology-prefixed `ellamaka-v1.15.13-4`.
 * Returns null for standard SemVer tags or non-CLI tags.
 */
export function parseLegacyTag(tag) {
  let version = null;
  if (tag.startsWith("ellamaka-v") && !tag.startsWith("ellamaka-cli-v") && !tag.startsWith("ellamaka-desktop-v")) {
    version = tag.slice("ellamaka-v".length);
  } else if (tag.startsWith("v") && /^\d/.test(tag.slice(1))) {
    version = tag.slice(1);
  } else {
    return null;
  }
  try {
    const legacy = parseLegacyVersion(version);
    return {
      product: PRODUCT,
      version,
      kind: "legacy",
      legacyShape: legacy.legacyShape,
    };
  } catch {
    return null;
  }
}

function versionFromPath(p) {
  // ellamaka/v1.17.1 → 1.17.1
  const m = p.match(/^ellamaka\/v(.+)$/);
  return m ? m[1] : null;
}

/**
 * Build the release reference graph. Any versioned path referenced by a
 * latest alias is protected. Legacy paths are classified but not protected.
 */
export function buildReferenceGraph(snapshot, aliases) {
  const protected_ = new Set();
  const protectedReason = new Map();
  const legacy = new Set();
  const standard = new Set();

  // Mark alias-referenced versions as protected.
  for (const [alias, version] of Object.entries(aliases)) {
    if (!alias.includes("ellamaka/latest")) continue;
    const path = `ellamaka/v${version}`;
    if (snapshot.versionedPaths.includes(path)) {
      protected_.add(path);
      protectedReason.set(path, `latest alias ${alias}`);
    }
  }

  // Classify all versioned paths.
  for (const p of snapshot.versionedPaths) {
    const version = versionFromPath(p);
    if (!version) continue;
    // Try standard first.
    try {
      parseReleaseVersion(version);
      standard.add(p);
      continue;
    } catch {
      // fall through to legacy
    }
    try {
      parseLegacyVersion(version);
      legacy.add(p);
      continue;
    } catch {
      // unknown — fail closed, treat as legacy (retained)
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

/**
 * Plan retention deletion for a product/channel. Uses standard SemVer
 * descending order. Protected releases are never deleted. Legacy releases
 * are retained (fail-closed).
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
    // Only same-channel releases are candidates.
    try {
      const parsed = parseReleaseVersion(version);
      if (parsed.channel !== channel) continue;
    } catch {
      continue;
    }
    candidates.push({ version, path: p, protected: graph.protected.has(p) });
  }

  // Sort descending by standard SemVer.
  candidates.sort((a, b) => compareSemVer(b.version, a.version));

  // Keep top N, but protected ones are always kept regardless of count.
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
 *
 * Returns { kept, skipped } where skipped items carry the protection reason.
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

/**
 * Plan a whole-version withdrawal. Per §9.2, the version must be recorded
 * in withdrawn-versions.json, and a healthy fallback must be specified and
 * present in the snapshot. Steps: restore aliases → delete versioned path →
 * delete tag.
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

  // Fallback must exist in versioned paths.
  const fallbackPath = `ellamaka/v${fallbackVersion}`;
  if (!snapshot.versionedPaths.includes(fallbackPath)) {
    return { allowed: false, reason: `fallback ${fallbackVersion} not found in versioned paths`, steps: [] };
  }

  const steps = [];
  // 1. Restore aliases pointing to the withdrawn version.
  for (const [alias, aliasVersion] of Object.entries(aliases)) {
    if (aliasVersion === version) {
      steps.push({ action: "restore-alias", target: alias });
    }
  }
  // 2. Delete the versioned path.
  steps.push({ action: "delete-versioned-path", target: `ellamaka/v${version}` });
  // 3. Delete the tag.
  steps.push({ action: "delete-tag", target: `ellamaka-cli-v${version}` });

  return { allowed: true, steps };
}

// ===========================================================================
// Execution layer: R2 / GitHub / Gitee probes + plan/apply
//
// Per Task 5 B-01: main() uses buildReferenceGraph + planRetention (NOT
// the removed selectForDeletion/compareVersions). Legacy and unknown objects
// fail closed (retained, never auto-deleted). Whole-version withdrawal uses
// planWithdraw.
// ===========================================================================

const R2_BUCKET = "wopal-release";
const R2_ROOT = "ellamaka";

function listR2Prefixes(r2Url) {
  const cmd = `aws s3api list-objects-v2 \
    --bucket ${R2_BUCKET} \
    --prefix "${R2_ROOT}/" \
    --delimiter "/" \
    --endpoint-url "${r2Url}" \
    --query "CommonPrefixes[].Prefix" \
    --output json`;
  const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  const prefixes = JSON.parse(output);
  return prefixes
    .map((p) => p.replace(R2_ROOT + "/", "").replace(/\/$/, ""))
    .filter((name) => name.startsWith("v") && /^\d/.test(name.slice(1)))
    .map((name) => `${R2_ROOT}/${name}`);
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

// Read the current latest alias version from R2.
function readLatestAlias(r2Url) {
  const cmd = `aws s3api get-object \
    --bucket ${R2_BUCKET} \
    --key "${R2_ROOT}/latest/manifest.json" \
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

function listGithubReleases(repo) {
  const cmd = `gh api repos/${repo}/releases --paginate --jq '[.[] | select(.tag_name | test("^ellamaka-cli-v"))] | .[].tag_name'`;
  const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  return output.trim().split("\n").filter(Boolean).filter((t) => t.startsWith("ellamaka-cli-v"));
}

// Ontology repo historically mirrored CLI releases with a bare `ellamaka-v*`
// prefix (e.g. ellamaka-v2.0.0). Since the naming switch to
// `ellamaka-cli-v*`, both prefixes can appear. List both so retention and
// withdrawal can clean stale ontology mirrors without deleting Desktop tags.
function listGithubOntologyReleases(repo) {
  const cmd = `gh api repos/${repo}/releases --paginate --jq '[.[] | select(.tag_name | test("^ellamaka-(cli-)?v"))] | .[].tag_name'`;
  const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter(
      (t) =>
        (t.startsWith("ellamaka-cli-v") || t.startsWith("ellamaka-v")) &&
        !t.startsWith("ellamaka-desktop-v"),
    );
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
    .filter((r) => r.tag_name && r.tag_name.startsWith("ellamaka-cli-v"))
    .map((r) => ({ id: r.id, tag_name: r.tag_name }));
}

// Ontology repo Gitee mirror: match both ellamaka-cli-v* and legacy
// ellamaka-v* prefixes (never ellamaka-desktop-v*).
function listGiteeOntologyReleases(token, repo) {
  const [owner, repoName] = repo.split("/");
  const url = `${GITEE_BASE}/repos/${owner}/${repoName}/releases?access_token=${encodeURIComponent(token)}&per_page=100`;
  const cmd = `curl -fsSL "${url}"`;
  const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  const releases = JSON.parse(output);
  return releases
    .filter(
      (r) =>
        r.tag_name &&
        (r.tag_name.startsWith("ellamaka-cli-v") || r.tag_name.startsWith("ellamaka-v")) &&
        !r.tag_name.startsWith("ellamaka-desktop-v"),
    )
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
  const flags = { mode: "retention", keep: 5, dryRun: false, withdrawVersion: null, fallback: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--keep") flags.keep = parseInt(args[++i], 10);
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
  console.log(`\n${mode}Cleaning up old ellamaka-cli releases (protection model, keep ${flags.keep} stable)\n`);

  // 1. Build snapshot from R2 + GitHub tags.
  console.log("=== R2: listing ellamaka/v* prefixes ===");
  let r2Paths = [];
  try {
    r2Paths = listR2Prefixes(r2Url);
    console.log(`  found ${r2Paths.length} versioned prefixes`);
  } catch (err) {
    console.error(`  R2 list failed: ${err.message}`);
  }

  // 2. Read current aliases (latest manifest).
  const latestVersion = readLatestAlias(r2Url);
  const aliases = latestVersion ? { "ellamaka/latest/manifest.json": latestVersion } : {};
  console.log(`  latest alias → ${latestVersion ?? "none"}`);

  // 3. Plan retention for the stable channel only. CLI publishes stable
  //    only (rc mechanism removed); beta/rc are not CLI release channels.
  const snapshot = { versionedPaths: r2Paths, tags: [] };
  const channels = [
    { channel: "stable", keep: flags.keep },
  ];
  const allDeleteCandidates = [];
  const allLegacyRetained = new Set();
  for (const { channel, keep } of channels) {
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

  // 4. W-06: re-read aliases and rebuild reference graph right before
  //    apply. Skip any candidate that became protected since the plan.
  const freshLatest = readLatestAlias(r2Url);
  const freshAliases = freshLatest ? { "ellamaka/latest/manifest.json": freshLatest } : {};
  const freshSnapshot = { versionedPaths: r2Paths, tags: [] };
  const freshGraph = buildReferenceGraph(freshSnapshot, freshAliases);
  const provisionalPlan = { deleteCandidates: allDeleteCandidates };
  const { kept, skipped } = applyRetentionWithRecheck(provisionalPlan, freshGraph);
  if (skipped.length > 0) {
    console.log(`  ${skipped.length} candidate(s) skipped (became protected since plan):`);
    for (const s of skipped) {
      console.log(`    skip ${s.path} — ${s.reason}`);
    }
  }

  // 5. Execute deletion on R2 versioned paths.
  if (kept.length > 0) {
    console.log(`  deleting ${kept.length} R2 prefixes:`);
    for (const c of kept) {
      try {
        deleteR2Prefix(r2Url, c.path, flags.dryRun);
      } catch (err) {
        console.error(`  failed to delete ${c.path}: ${err.message}`);
      }
    }
  } else {
    console.log("  nothing to delete (R2)");
  }

  // 6. GitHub + Gitee release pages: delete matching tags for deleted versions.
  const deletedVersions = new Set(kept.map((c) => c.version));
  if (deletedVersions.size > 0) {
    console.log("\n=== GitHub (wopal-cn/ellamaka): matching ellamaka-cli-v* releases ===");
    try {
      const ghTags = listGithubReleases("wopal-cn/ellamaka");
      for (const tag of ghTags) {
        const parsed = parseReleaseTag(tag);
        if (parsed && deletedVersions.has(parsed.version)) {
          deleteGithubRelease("wopal-cn/ellamaka", tag, flags.dryRun);
        }
      }
    } catch (err) {
      console.error(`  GitHub list failed: ${err.message}`);
    }

    if (giteeToken) {
      console.log("\n=== Gitee (wopal-cn/ellamaka): matching ellamaka-cli-v* releases ===");
      try {
        const giteeReleases = listGiteeReleases(giteeToken, "wopal-cn/ellamaka");
        for (const release of giteeReleases) {
          const parsed = parseReleaseTag(release.tag_name);
          if (parsed && deletedVersions.has(parsed.version)) {
            deleteGiteeRelease(giteeToken, "wopal-cn/ellamaka", release, flags.dryRun);
          }
        }
      } catch (err) {
        console.error(`  Gitee list failed: ${err.message}`);
      }
    }

    // Ontology repo mirrors CLI releases under ellamaka-cli-v* (new) or
    // ellamaka-v* (legacy). Clean both so retention also prunes stale
    // ontology release pages. Desktop tags (ellamaka-desktop-v*) are
    // excluded — they belong to the desktop cleanup script.
    console.log("\n=== GitHub (wopal-cn/wopal-space-ontology): matching ellamaka-{cli-,}v* releases ===");
    try {
      const ghOntTags = listGithubOntologyReleases("wopal-cn/wopal-space-ontology");
      for (const tag of ghOntTags) {
        const version = tag.startsWith("ellamaka-cli-v")
          ? tag.slice("ellamaka-cli-v".length)
          : tag.slice("ellamaka-v".length);
        if (deletedVersions.has(version)) {
          deleteGithubRelease("wopal-cn/wopal-space-ontology", tag, flags.dryRun);
        }
      }
    } catch (err) {
      console.error(`  GitHub ontology list failed: ${err.message}`);
    }

    if (giteeToken) {
      console.log("\n=== Gitee (wopal-cn/wopal-space-ontology): matching ellamaka-{cli-,}v* releases ===");
      try {
        const giteeOntReleases = listGiteeOntologyReleases(giteeToken, "wopal-cn/wopal-space-ontology");
        for (const release of giteeOntReleases) {
          const version = release.tag_name.startsWith("ellamaka-cli-v")
            ? release.tag_name.slice("ellamaka-cli-v".length)
            : release.tag_name.slice("ellamaka-v".length);
          if (deletedVersions.has(version)) {
            deleteGiteeRelease(giteeToken, "wopal-cn/wopal-space-ontology", release, flags.dryRun);
          }
        }
      } catch (err) {
        console.error(`  Gitee ontology list failed: ${err.message}`);
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

  console.log(`\nWithdrawing ellamaka-cli v${flags.withdrawVersion} (fallback: ${flags.fallback})\n`);

  // Read withdrawn-versions.json
  const withdrawn = JSON.parse(fs.readFileSync("release/withdrawn-versions.json", "utf8"));

  // Build snapshot + aliases.
  const r2Paths = listR2Prefixes(r2Url);
  const latestVersion = readLatestAlias(r2Url);
  const aliases = latestVersion ? { "ellamaka/latest/manifest.json": latestVersion } : {};
  const snapshot = { versionedPaths: r2Paths, tags: [] };

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

  // Execute steps in order. Per §9.2: restore aliases → delete versioned path → delete tag.
  for (const step of plan.steps) {
    if (step.action === "restore-alias") {
      console.log(`  restoring alias ${step.target} → ${flags.fallback}`);
      // Restore alias by copying the fallback manifest to the latest alias key.
      const fallbackManifestKey = `${R2_ROOT}/v${flags.fallback}/manifest.json`;
      execSync(
        `aws s3 cp "s3://${R2_BUCKET}/${fallbackManifestKey}" "s3://${R2_BUCKET}/${step.target}" --endpoint-url "${r2Url}"`,
        { stdio: "inherit" },
      );
    } else if (step.action === "delete-versioned-path") {
      deleteR2Prefix(r2Url, step.target, false);
    } else if (step.action === "delete-tag") {
      try {
        deleteGithubRelease("wopal-cn/ellamaka", step.target, false);
      } catch (err) {
        console.error(`  failed to delete tag on GitHub: ${err.message}`);
      }
      if (giteeToken) {
        try {
          const giteeReleases = listGiteeReleases(giteeToken, "wopal-cn/ellamaka");
          const match = giteeReleases.find((r) => r.tag_name === step.target);
          if (match) deleteGiteeRelease(giteeToken, "wopal-cn/ellamaka", match, false);
        } catch (err) {
          console.error(`  Gitee tag delete failed: ${err.message}`);
        }
      }
      // Sync-delete the same version from the ontology mirror (both the
      // new ellamaka-cli-v* and legacy ellamaka-v* naming), if present.
      const version = step.target.replace(/^ellamaka-cli-v/, "");
      try {
        const ghOntTags = listGithubOntologyReleases("wopal-cn/wopal-space-ontology");
        for (const tag of ghOntTags) {
          const v = tag.startsWith("ellamaka-cli-v")
            ? tag.slice("ellamaka-cli-v".length)
            : tag.slice("ellamaka-v".length);
          if (v === version) deleteGithubRelease("wopal-cn/wopal-space-ontology", tag, false);
        }
      } catch (err) {
        console.error(`  GitHub ontology tag delete failed: ${err.message}`);
      }
      if (giteeToken) {
        try {
          const giteeOntReleases = listGiteeOntologyReleases(giteeToken, "wopal-cn/wopal-space-ontology");
          for (const release of giteeOntReleases) {
            const v = release.tag_name.startsWith("ellamaka-cli-v")
              ? release.tag_name.slice("ellamaka-cli-v".length)
              : release.tag_name.slice("ellamaka-v".length);
            if (v === version) deleteGiteeRelease(giteeToken, "wopal-cn/wopal-space-ontology", release, false);
          }
        } catch (err) {
          console.error(`  Gitee ontology tag delete failed: ${err.message}`);
        }
      }
    }
  }

  // Purge CDN for the restored alias.
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
