#!/usr/bin/env node

/**
 * cleanup-desktop-releases.mjs
 *
 * Prunes historical ellamaka-desktop releases across three platforms,
 * keeping the N most recent stable releases plus the M most recent beta
 * releases.
 *
 * Platforms cleaned:
 *   1. Cloudflare R2 — delete ellamaka-desktop/v<VERSION>/ (prod) and
 *      ellamaka-desktop/beta/v<VERSION>/ (beta) prefixes. Never touches
 *      latest/ aliases.
 *   2. GitHub (wopal-cn/ellamaka) — delete releases tagged
 *      ellamaka-desktop-v<VERSION>. Leaves v* and ellamaka-v* alone.
 *   3. GitHub (wopal-cn/wopal-space-ontology) — delete releases tagged
 *      ellamaka-desktop-v<VERSION>. Leaves cli-v* and ellamaka-v* alone.
 *   4. Gitee (wopal-cn/ellamaka) — same tag filter.
 *   5. Gitee (wopal-cn/wopal-space-ontology) — same tag filter.
 *
 * Tag → version parsing:
 *   ellamaka-desktop-v1.15.13-2      → { version: "1.15.13-2",      channel: "prod" }
 *   ellamaka-desktop-v1.15.13-beta.3 → { version: "1.15.13-beta.3", channel: "beta" }
 *
 * Sorting: version string descending (natural lexicographic order works
 * because the format is zero-padded enough for practical comparison).
 * Prod and beta are tracked in separate buckets.
 *
 * Usage:
 *   node scripts/cleanup-desktop-releases.mjs --keep-prod 3 --keep-beta 2 [--dry-run]
 *
 * Environment variables:
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / R2_ENDPOINT — R2 credentials
 *   GH_TOKEN    — GitHub PAT with repo scope on both wopal-cn repos
 *   GITEE_TOKEN — Gitee API token
 */

import { execSync } from "child_process";

// --- Exported helpers (for unit testing) ---

const TAG_PREFIX = "ellamaka-desktop-v";

export function parseTag(tag) {
  if (!tag.startsWith(TAG_PREFIX)) return null;
  const version = tag.slice(TAG_PREFIX.length);
  if (!version) return null;
  const isBeta = version.includes("-beta.");
  return { tag, version, channel: isBeta ? "beta" : "prod" };
}

/**
 * Compare two version strings for descending sort.
 * Versions share a core like "1.15.13"; prod appends "-N", beta appends "-beta.N".
 * We compare core numerically, then suffix with beta < prod (so for the same
 * core, beta.3 < 2 i.e. beta sorts after prod in descending order).
 *
 * Returns negative if a should sort before b (a is newer/higher).
 */
export function compareVersions(a, b) {
  const parseCore = (v) => v.split(/[-]/)[0].split(".").map((n) => parseInt(n, 10) || 0);
  const aCore = parseCore(a.version);
  const bCore = parseCore(b.version);
  const maxLen = Math.max(aCore.length, bCore.length);
  for (let i = 0; i < maxLen; i++) {
    const diff = (bCore[i] || 0) - (aCore[i] || 0);
    if (diff !== 0) return diff; // descending
  }
  // Same core: compare suffix. prod "-N" vs beta "-beta.N"
  // beta should sort after prod (prod is "higher" / newer in practice).
  if (a.channel === b.channel) {
    // Same channel: compare suffix numbers
    const aNum = parseInt(a.version.match(/(\d+)$/)?.[1] || "0", 10);
    const bNum = parseInt(b.version.match(/(\d+)$/)?.[1] || "0", 10);
    return bNum - aNum; // descending
  }
  // prod sorts before beta in descending order (prod is higher)
  return a.channel === "prod" ? -1 : 1;
}

export function partitionTags(tags) {
  const prod = [];
  const beta = [];
  for (const tag of tags) {
    const parsed = parseTag(tag);
    if (!parsed) continue;
    if (parsed.channel === "beta") beta.push(parsed);
    else prod.push(parsed);
  }
  prod.sort(compareVersions);
  beta.sort(compareVersions);
  return { prod, beta };
}

export function selectForDeletion(tags, keepProd, keepBeta) {
  const { prod, beta } = partitionTags(tags);
  const keepSet = new Set();
  for (const v of prod.slice(0, keepProd)) keepSet.add(v.tag);
  for (const v of beta.slice(0, keepBeta)) keepSet.add(v.tag);
  return tags.filter((t) => !keepSet.has(t));
}

// --- Args ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { keepProd: 3, keepBeta: 2, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--keep-prod") flags.keepProd = parseInt(args[++i], 10);
    else if (a === "--keep-beta") flags.keepBeta = parseInt(args[++i], 10);
    else if (a === "--dry-run") flags.dryRun = true;
  }
  return flags;
}

// --- R2 cleanup ---

const R2_BUCKET = "wopal-release";

/**
 * List all v* versioned prefixes under a given R2 root path.
 * Returns tag strings like "ellamaka-desktop-v1.15.13-2".
 */
function listR2VersionedPrefixes(r2Url, r2Root) {
  // List with delimiter to get common prefixes (subdirectories)
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
    .filter((p) => {
      // Extract the subdirectory name: "ellamaka-desktop/v1.15.13-2/" → "v1.15.13-2"
      const name = p.replace(r2Root + "/", "").replace(/\/$/, "");
      return name.startsWith("v");
    })
    .map((p) => {
      const name = p.replace(r2Root + "/", "").replace(/\/$/, "");
      return `${TAG_PREFIX}${name.slice(1)}`; // "v1.15.13-2" → "ellamaka-desktop-v1.15.13-2"
    });
}

function deleteR2Prefix(r2Url, r2Root, version, dryRun) {
  const s3Key = `s3://${R2_BUCKET}/${r2Root}/v${version}/`;
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

const GH_REPO = "wopal-cn/wopal-space-ontology";
const ELLAMAKA_REPO = "wopal-cn/ellamaka";

function listGithubReleases(repo) {
  const cmd = `gh api repos/${repo}/releases --paginate --jq '[.[] | select(.tag_name | startswith("${TAG_PREFIX}"))] | .[].tag_name'`;
  const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  return output.trim().split("\n").filter((t) => t.startsWith(TAG_PREFIX));
}

function deleteGithubRelease(repo, tag, dryRun) {
  if (dryRun) {
    console.log(`  [DRY RUN] would delete GitHub release ${repo}:${tag}`);
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
  console.log(`  deleted GitHub release ${repo}:${tag}`);
}

// --- Gitee cleanup ---

const GITEE_BASE = "https://gitee.com/api/v5";

function listGiteeReleases(token, repo) {
  const [owner, repoName] = repo.split("/");
  const url = `${GITEE_BASE}/repos/${owner}/${repoName}/releases?access_token=${encodeURIComponent(token)}&per_page=100`;
  const cmd = `curl -fsSL "${url}"`;
  const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  const releases = JSON.parse(output);
  return releases
    .filter((r) => r.tag_name && r.tag_name.startsWith(TAG_PREFIX))
    .map((r) => ({ id: r.id, tag_name: r.tag_name }));
}

function deleteGiteeRelease(token, repo, release, dryRun) {
  const [owner, repoName] = repo.split("/");
  if (dryRun) {
    console.log(`  [DRY RUN] would delete Gitee release ${repo}:${release.tag_name} (id=${release.id})`);
    return;
  }
  const url = `${GITEE_BASE}/repos/${owner}/${repoName}/releases/${release.id}?access_token=${encodeURIComponent(token)}`;
  execSync(`curl -fsSL -X DELETE "${url}"`, { stdio: "inherit" });
  console.log(`  deleted Gitee release ${repo}:${release.tag_name} (id=${release.id})`);
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
  console.log(
    `\n${mode}Cleaning up old desktop releases (keep ${flags.keepProd} prod + ${flags.keepBeta} beta)\n`,
  );

  // --- R2 prod ---
  const PROD_ROOT = "ellamaka-desktop";
  console.log("=== R2 (prod): listing versioned prefixes ===");
  let r2ProdTags = [];
  try {
    r2ProdTags = listR2VersionedPrefixes(r2Url, PROD_ROOT);
    console.log(`  found ${r2ProdTags.length} prod versioned prefixes`);
  } catch (err) {
    console.error(`  R2 prod list failed: ${err.message}`);
  }
  const r2ProdDelete = selectForDeletion(r2ProdTags, flags.keepProd, 0);
  if (r2ProdDelete.length > 0) {
    console.log(`  deleting ${r2ProdDelete.length} prod R2 prefixes:`);
    for (const tag of r2ProdDelete) {
      const parsed = parseTag(tag);
      try {
        deleteR2Prefix(r2Url, PROD_ROOT, parsed.version, flags.dryRun);
      } catch (err) {
        console.error(`  failed to delete ${tag}: ${err.message}`);
      }
    }
  } else {
    console.log("  nothing to delete");
  }

  // --- R2 beta ---
  const BETA_ROOT = "ellamaka-desktop/beta";
  console.log("\n=== R2 (beta): listing versioned prefixes ===");
  let r2BetaTags = [];
  try {
    r2BetaTags = listR2VersionedPrefixes(r2Url, BETA_ROOT);
    console.log(`  found ${r2BetaTags.length} beta versioned prefixes`);
  } catch (err) {
    console.error(`  R2 beta list failed: ${err.message}`);
  }
  const r2BetaDelete = selectForDeletion(r2BetaTags, 0, flags.keepBeta);
  if (r2BetaDelete.length > 0) {
    console.log(`  deleting ${r2BetaDelete.length} beta R2 prefixes:`);
    for (const tag of r2BetaDelete) {
      const parsed = parseTag(tag);
      try {
        deleteR2Prefix(r2Url, BETA_ROOT, parsed.version, flags.dryRun);
      } catch (err) {
        console.error(`  failed to delete ${tag}: ${err.message}`);
      }
    }
  } else {
    console.log("  nothing to delete");
  }

  // --- GitHub: wopal-cn/ellamaka ---
  console.log(`\n=== GitHub (${ELLAMAKA_REPO}): listing ellamaka-desktop-v* releases ===`);
  const ghEllamakaTags = listGithubReleases(ELLAMAKA_REPO);
  console.log(`  found ${ghEllamakaTags.length} ellamaka-desktop-v* releases`);
  const ghEllamakaDelete = selectForDeletion(ghEllamakaTags, flags.keepProd, flags.keepBeta);
  if (ghEllamakaDelete.length > 0) {
    console.log(`  deleting ${ghEllamakaDelete.length} releases:`);
    for (const tag of ghEllamakaDelete) {
      try {
        deleteGithubRelease(ELLAMAKA_REPO, tag, flags.dryRun);
      } catch (err) {
        console.error(`  failed to delete ${tag}: ${err.message}`);
      }
    }
  } else {
    console.log("  nothing to delete");
  }

  // --- GitHub: wopal-cn/wopal-space-ontology ---
  console.log(`\n=== GitHub (${GH_REPO}): listing ellamaka-desktop-v* releases ===`);
  const ghTags = listGithubReleases(GH_REPO);
  console.log(`  found ${ghTags.length} ellamaka-desktop-v* releases`);
  const ghDelete = selectForDeletion(ghTags, flags.keepProd, flags.keepBeta);
  if (ghDelete.length > 0) {
    console.log(`  deleting ${ghDelete.length} releases:`);
    for (const tag of ghDelete) {
      try {
        deleteGithubRelease(GH_REPO, tag, flags.dryRun);
      } catch (err) {
        console.error(`  failed to delete ${tag}: ${err.message}`);
      }
    }
  } else {
    console.log("  nothing to delete");
  }

  // --- Gitee ---
  if (giteeToken) {
    console.log(`\n=== Gitee (${ELLAMAKA_REPO}): listing ellamaka-desktop-v* releases ===`);
    let giteeEllamakaReleases = [];
    try {
      giteeEllamakaReleases = listGiteeReleases(giteeToken, ELLAMAKA_REPO);
      console.log(`  found ${giteeEllamakaReleases.length} ellamaka-desktop-v* releases`);
    } catch (err) {
      console.error(`  Gitee list failed: ${err.message}`);
    }
    const giteeEllamakaTags = giteeEllamakaReleases.map((r) => r.tag_name);
    const giteeEllamakaDeleteTags = selectForDeletion(giteeEllamakaTags, flags.keepProd, flags.keepBeta);
    const giteeEllamakaDelete = giteeEllamakaReleases.filter((r) => giteeEllamakaDeleteTags.includes(r.tag_name));
    if (giteeEllamakaDelete.length > 0) {
      console.log(`  deleting ${giteeEllamakaDelete.length} releases:`);
      for (const release of giteeEllamakaDelete) {
        try {
          deleteGiteeRelease(giteeToken, ELLAMAKA_REPO, release, flags.dryRun);
        } catch (err) {
          console.error(`  failed to delete ${release.tag_name}: ${err.message}`);
        }
      }
    } else {
      console.log("  nothing to delete");
    }

    console.log(`\n=== Gitee (${GH_REPO}): listing ellamaka-desktop-v* releases ===`);
    let giteeReleases = [];
    try {
      giteeReleases = listGiteeReleases(giteeToken, GH_REPO);
      console.log(`  found ${giteeReleases.length} ellamaka-desktop-v* releases`);
    } catch (err) {
      console.error(`  Gitee list failed: ${err.message}`);
    }
    const giteeTags = giteeReleases.map((r) => r.tag_name);
    const giteeDeleteTags = selectForDeletion(giteeTags, flags.keepProd, flags.keepBeta);
    const giteeDelete = giteeReleases.filter((r) => giteeDeleteTags.includes(r.tag_name));
    if (giteeDelete.length > 0) {
      console.log(`  deleting ${giteeDelete.length} releases:`);
      for (const release of giteeDelete) {
        try {
          deleteGiteeRelease(giteeToken, GH_REPO, release, flags.dryRun);
        } catch (err) {
          console.error(`  failed to delete ${release.tag_name}: ${err.message}`);
        }
      }
    } else {
      console.log("  nothing to delete");
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
