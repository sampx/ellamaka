#!/usr/bin/env node

/**
 * cleanup-ellamaka-releases.mjs
 *
 * Prunes historical ellamaka CLI releases across four surfaces, keeping
 * the N most recent stable releases plus the M most recent prerelease
 * releases (e.g. rc).
 *
 * Surfaces cleaned:
 *   1. Cloudflare R2 — delete ellamaka/v<VERSION>/ prefixes (never latest/)
 *   2. GitHub (wopal-cn/ellamaka) — delete releases tagged v<VERSION>
 *   3. GitHub (wopal-cn/wopal-space-ontology) — delete releases tagged
 *      ellamaka-v<VERSION> (leaves cli-v* and ellamaka-desktop-v* alone)
 *   4. Gitee (wopal-cn/ellamaka) — delete releases tagged v<VERSION>
 *   5. Gitee (wopal-cn/wopal-space-ontology) — delete releases tagged
 *      ellamaka-v<VERSION>
 *
 * Version format: X.Y.Z or X.Y.Z-N (e.g. 1.15.13, 1.15.13-3).
 * Prerelease: version contains "-" and the suffix is NOT purely numeric
 * (e.g. 1.15.13-rc1). Pure numeric suffix (1.15.13-3) is treated as stable
 * patch iteration.
 *
 * Sorting: semver descending. Stable and prerelease are tracked in
 * separate buckets.
 *
 * Usage:
 *   node scripts/cleanup-ellamaka-releases.mjs --keep 5 --keep-prerelease 1 [--dry-run]
 *
 * Environment variables:
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / R2_ENDPOINT — R2 credentials
 *   GH_TOKEN    — GitHub PAT with repo scope on both repos
 *   GITEE_TOKEN — Gitee API token
 */

import { execSync } from "child_process";
import { compareSemVer, parseReleaseVersion, parseLegacyVersion } from "./release-identity.mjs";

// ===========================================================================
// Task 5: protection model (docs/RELEASE-IDENTITY.md §9.1)
//
// cleanup must NOT use sort -V, mtime, or the legacy X.Y.Z-N numeric-suffix
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

// ---------------------------------------------------------------------------
// Legacy retention helpers (retained for backward compat with any caller
// that still uses the old selectForDeletion API; new code should use
// planRetention).
// ---------------------------------------------------------------------------

// --- Exported helpers (for unit testing) ---

const TAG_PREFIX = "ellamaka-v"; // ontology repo prefix; ellamaka repo uses "v" only

/**
 * Parse a version string into a comparable version object.
 * Handles both bare (v1.15.13) and ontology-prefixed (ellamaka-v1.15.13) tags.
 *
 * Prerelease detection: suffix is non-numeric (e.g. -rc1, -beta.2).
 * Numeric suffix (e.g. -3) is a stable patch iteration, not prerelease.
 */
export function parseTag(tag) {
  let version = tag;
  if (tag.startsWith(TAG_PREFIX)) {
    version = tag.slice(TAG_PREFIX.length);
  } else if (tag.startsWith("v") && /^\d/.test(tag.slice(1))) {
    version = tag.slice(1);
  } else {
    return null;
  }
  if (!version) return null;

  const [core, suffix] = version.split(/-(.*)/);
  // Prerelease: has a suffix AND suffix is not purely numeric
  const isPrerelease = suffix !== undefined && !/^\d+$/.test(suffix);
  return { tag, version, core, suffix: suffix || "", isPrerelease };
}

/**
 * Compare two version objects for descending sort.
 * Returns negative if a should sort before b (a is newer/higher).
 */
export function compareVersions(a, b) {
  const parsePart = (s) => parseInt(s, 10) || 0;
  const aParts = a.core.split(".").map(parsePart);
  const bParts = b.core.split(".").map(parsePart);
  const maxLen = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < maxLen; i++) {
    const diff = (bParts[i] || 0) - (aParts[i] || 0);
    if (diff !== 0) return diff; // descending
  }

  // Same core: compare suffix. Numeric suffix → compare as numbers.
  if (a.suffix && b.suffix && /^\d+$/.test(a.suffix) && /^\d+$/.test(b.suffix)) {
    return parseInt(b.suffix, 10) - parseInt(a.suffix, 10);
  }

  // Numeric suffix (patch iteration like -3) is newer than no suffix.
  if (a.suffix && /^\d+$/.test(a.suffix) && !b.suffix) return -1;
  if (!a.suffix && b.suffix && /^\d+$/.test(b.suffix)) return 1;

  // Stable (no suffix) sorts before prerelease (non-numeric suffix).
  if (!a.suffix && b.suffix) return -1;
  if (a.suffix && !b.suffix) return 1;
  if (a.suffix && b.suffix) {
    const aNum = parseInt(a.suffix.match(/(\d+)$/)?.[1] || "0", 10);
    const bNum = parseInt(b.suffix.match(/(\d+)$/)?.[1] || "0", 10);
    if (aNum !== bNum) return bNum - aNum;
    return b.suffix.localeCompare(a.suffix);
  }
  return 0;
}

export function partitionTags(tags) {
  const stable = [];
  const prerelease = [];
  for (const tag of tags) {
    const parsed = parseTag(tag);
    if (!parsed) continue;
    if (parsed.isPrerelease) prerelease.push(parsed);
    else stable.push(parsed);
  }
  stable.sort(compareVersions);
  prerelease.sort(compareVersions);
  return { stable, prerelease };
}

export function selectForDeletion(tags, keepStable, keepPrerelease) {
  const { stable, prerelease } = partitionTags(tags);
  const keepSet = new Set();
  for (const v of stable.slice(0, keepStable)) keepSet.add(v.tag);
  for (const v of prerelease.slice(0, keepPrerelease)) keepSet.add(v.tag);
  return tags.filter((t) => !keepSet.has(t));
}

// --- Args ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { keep: 5, keepPrerelease: 1, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--keep") flags.keep = parseInt(args[++i], 10);
    else if (a === "--keep-prerelease") flags.keepPrerelease = parseInt(args[++i], 10);
    else if (a === "--dry-run") flags.dryRun = true;
  }
  return flags;
}

// --- R2 cleanup ---

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
    .filter((p) => {
      const name = p.replace(R2_ROOT + "/", "").replace(/\/$/, "");
      return name.startsWith("v") && /^\d/.test(name.slice(1));
    })
    .map((p) => {
      const name = p.replace(R2_ROOT + "/", "").replace(/\/$/, "");
      return name; // "v1.15.13-3" — keep the "v" prefix, R2 key uses it
    });
}

function deleteR2Prefix(r2Url, r2Prefix, dryRun) {
  const s3Key = `s3://${R2_BUCKET}/${R2_ROOT}/${r2Prefix}/`;
  if (dryRun) {
    console.log(`  [DRY RUN] would delete ${s3Key}`);
    return;
  }
  execSync(`aws s3 rm "${s3Key}" --recursive --endpoint-url "${r2Url}"`, {
    stdio: "inherit",
  });
  console.log(`  deleted ${s3Key}`);
}

// --- GitHub cleanup ---

function listGithubReleases(repo, tagFilter) {
  const cmd = `gh api repos/${repo}/releases --paginate --jq '[.[] | select(.tag_name | test("${tagFilter}"))] | .[].tag_name'`;
  const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  return output.trim().split("\n").filter(Boolean);
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

// --- Gitee cleanup ---

const GITEE_BASE = "https://gitee.com/api/v5";

function listGiteeReleases(token, repo) {
  const [owner, repoName] = repo.split("/");
  const url = `${GITEE_BASE}/repos/${owner}/${repoName}/releases?access_token=${encodeURIComponent(token)}&per_page=100`;
  const cmd = `curl -fsSL "${url}"`;
  const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  const releases = JSON.parse(output);
  return releases.map((r) => ({ id: r.id, tag_name: r.tag_name }));
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
  console.log(`\n${mode}Cleaning up old ellamaka releases (keep ${flags.keep} stable + ${flags.keepPrerelease} prerelease)\n`);

  // --- R2 ---
  console.log("=== R2: listing ellamaka/v* prefixes ===");
  let r2Prefixes = [];
  try {
    r2Prefixes = listR2Prefixes(r2Url);
    console.log(`  found ${r2Prefixes.length} versioned prefixes`);
  } catch (err) {
    console.error(`  R2 list failed: ${err.message}`);
  }
  // R2 prefixes are like "v1.15.13-3"; convert to tag format for selectForDeletion
  const r2Tags = r2Prefixes.map((p) => `v${p.slice(1)}`); // "v1.15.13-3" → tag "v1.15.13-3"
  const r2DeleteTags = selectForDeletion(r2Tags, flags.keep, flags.keepPrerelease);
  // Convert back to R2 prefix for deletion
  const r2Delete = r2DeleteTags.map((t) => `v${t.slice(1)}`);
  if (r2Delete.length > 0) {
    console.log(`  deleting ${r2Delete.length} R2 prefixes:`);
    for (const prefix of r2Delete) {
      try { deleteR2Prefix(r2Url, prefix, flags.dryRun); } catch (err) {
        console.error(`  failed to delete ${prefix}: ${err.message}`);
      }
    }
  } else {
    console.log("  nothing to delete");
  }

  // --- GitHub: wopal-cn/ellamaka (tag format: v1.15.13-3) ---
  console.log("\n=== GitHub (wopal-cn/ellamaka): listing v* releases ===");
  const ghEllamakaTags = listGithubReleases("wopal-cn/ellamaka", "^v[0-9]");
  console.log(`  found ${ghEllamakaTags.length} v* releases`);
  const ghEllamakaDelete = selectForDeletion(ghEllamakaTags, flags.keep, flags.keepPrerelease);
  if (ghEllamakaDelete.length > 0) {
    console.log(`  deleting ${ghEllamakaDelete.length} releases:`);
    for (const tag of ghEllamakaDelete) {
      try { deleteGithubRelease("wopal-cn/ellamaka", tag, flags.dryRun); } catch (err) {
        console.error(`  failed to delete ${tag}: ${err.message}`);
      }
    }
  } else {
    console.log("  nothing to delete");
  }

  // --- GitHub: wopal-cn/wopal-space-ontology (tag format: ellamaka-v1.15.13-3) ---
  console.log("\n=== GitHub (wopal-cn/wopal-space-ontology): listing ellamaka-v* releases ===");
  const ghOntTags = listGithubReleases("wopal-cn/wopal-space-ontology", "^ellamaka-v");
  console.log(`  found ${ghOntTags.length} ellamaka-v* releases`);
  const ghOntDelete = selectForDeletion(ghOntTags, flags.keep, flags.keepPrerelease);
  if (ghOntDelete.length > 0) {
    console.log(`  deleting ${ghOntDelete.length} releases:`);
    for (const tag of ghOntDelete) {
      try { deleteGithubRelease("wopal-cn/wopal-space-ontology", tag, flags.dryRun); } catch (err) {
        console.error(`  failed to delete ${tag}: ${err.message}`);
      }
    }
  } else {
    console.log("  nothing to delete");
  }

  // --- Gitee ---
  if (giteeToken) {
    // Gitee: wopal-cn/ellamaka (tag format: v1.15.13-3)
    console.log("\n=== Gitee (wopal-cn/ellamaka): listing v* releases ===");
    let giteeEllamaka = [];
    try {
      giteeEllamaka = listGiteeReleases(giteeToken, "wopal-cn/ellamaka");
      const filtered = giteeEllamaka.filter((r) => /^v[0-9]/.test(r.tag_name));
      console.log(`  found ${filtered.length} v* releases`);
      const giteeEllamakaTags = filtered.map((r) => r.tag_name);
      const deleteTags = selectForDeletion(giteeEllamakaTags, flags.keep, flags.keepPrerelease);
      const toDelete = filtered.filter((r) => deleteTags.includes(r.tag_name));
      if (toDelete.length > 0) {
        console.log(`  deleting ${toDelete.length} releases:`);
        for (const release of toDelete) {
          try { deleteGiteeRelease(giteeToken, "wopal-cn/ellamaka", release, flags.dryRun); } catch (err) {
            console.error(`  failed to delete ${release.tag_name}: ${err.message}`);
          }
        }
      } else {
        console.log("  nothing to delete");
      }
    } catch (err) {
      console.error(`  Gitee list failed: ${err.message}`);
    }

    // Gitee: wopal-cn/wopal-space-ontology (tag format: ellamaka-v1.15.13-3)
    console.log("\n=== Gitee (wopal-cn/wopal-space-ontology): listing ellamaka-v* releases ===");
    let giteeOnt = [];
    try {
      giteeOnt = listGiteeReleases(giteeToken, "wopal-cn/wopal-space-ontology");
      const filtered = giteeOnt.filter((r) => /^ellamaka-v/.test(r.tag_name));
      console.log(`  found ${filtered.length} ellamaka-v* releases`);
      const giteeOntTags = filtered.map((r) => r.tag_name);
      const deleteTags = selectForDeletion(giteeOntTags, flags.keep, flags.keepPrerelease);
      const toDelete = filtered.filter((r) => deleteTags.includes(r.tag_name));
      if (toDelete.length > 0) {
        console.log(`  deleting ${toDelete.length} releases:`);
        for (const release of toDelete) {
          try { deleteGiteeRelease(giteeToken, "wopal-cn/wopal-space-ontology", release, flags.dryRun); } catch (err) {
            console.error(`  failed to delete ${release.tag_name}: ${err.message}`);
          }
        }
      } else {
        console.log("  nothing to delete");
      }
    } catch (err) {
      console.error(`  Gitee list failed: ${err.message}`);
    }
  } else {
    console.log("\n=== Gitee: skipped (GITEE_TOKEN not set) ===");
  }

  console.log(`\n${mode}Cleanup complete.\n`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly && !process.env.VITEST) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}