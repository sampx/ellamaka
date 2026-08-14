// packages/ellamaka-release/src/cleanup/execute.ts
//
// Injectable execution primitives for the cleanup retention flow (W-02).
// The CLI wires the real aws/gh/curl-backed implementations; tests inject
// fakes to verify dry-run zero-write, partial-failure propagation (B-03),
// and per-product tag/ontology matching.

import { parseReleaseTag } from "./parse"
import type { ProductConfig, RetentionCandidate } from "./types"

/**
 * Executable operations required to run retention. Injected so tests can
 * observe calls without touching R2 / GitHub / Gitee.
 */
export type RetentionOps = {
  /** Delete an R2 versioned prefix. Throws on failure. dry-run is a no-op. */
  deleteR2: (path: string, dryRun: boolean) => void
  /** List a product's GitHub releases (tags). */
  listGithub: (repo: string) => string[]
  /** Delete a GitHub release + tag. */
  deleteGithub: (repo: string, tag: string, dryRun: boolean) => void
  /** List a product's ontology-mirror GitHub releases. */
  listGithubOntology: (repo: string) => string[]
  /** List a product's Gitee releases (optional; skipped when null). */
  listGitee?: (token: string, repo: string) => Array<{ id: number; tag_name: string }>
  /** List a product's ontology-mirror Gitee releases. */
  listGiteeOntology?: (token: string, repo: string) => Array<{ id: number; tag_name: string }>
  /** Delete a Gitee release + tag. */
  deleteGitee?: (token: string, repo: string, release: { id: number; tag_name: string }, dryRun: boolean) => void
}

export type RetentionExecResult = {
  /** Versions whose R2 delete succeeded (in dry-run: all planned). */
  deletedVersions: Set<string>
  /** Versioned paths whose R2 delete failed (apply mode only). */
  failures: string[]
}

/**
 * Execute a retention plan's R2 deletions and the lockstep registry/tag
 * cleanup. Only versions whose R2 delete SUCCEEDED may have their GitHub /
 * Gitee / ontology Release and tag deleted (B-03): a failed R2 delete must
 * never leave an orphaned CDN asset. In dry-run the R2 "delete" is a no-op
 * that always succeeds, so every kept candidate is planned for registry/tag
 * deletion too. Returns the versions deleted and any R2 failures.
 */
export function executeRetention({
  config,
  kept,
  dryRun,
  giteeToken,
  ghRepo,
  ghOntRepo,
  ops,
}: {
  config: ProductConfig
  kept: RetentionCandidate[]
  dryRun: boolean
  giteeToken?: string
  ghRepo: string
  ghOntRepo: string
  ops: RetentionOps
}): RetentionExecResult {
  const deletedVersions = new Set<string>()
  const failures: string[] = []

  if (kept.length > 0) {
    for (const c of kept) {
      try {
        ops.deleteR2(c.path, dryRun)
        deletedVersions.add(c.version)
      } catch (err) {
        if (!dryRun) failures.push(c.path)
        console.error(`  failed to delete ${c.path}: ${(err as Error).message}`)
      }
    }
  }

  if (deletedVersions.size === 0) {
    return { deletedVersions, failures }
  }

  // Main repo GitHub releases.
  for (const tag of ops.listGithub(ghRepo)) {
    const parsed = parseReleaseTag(config, tag)
    if (parsed && deletedVersions.has(parsed.version)) {
      ops.deleteGithub(ghRepo, tag, dryRun)
    }
  }

  // Main repo Gitee releases.
  if (giteeToken && ops.listGitee) {
    for (const release of ops.listGitee(giteeToken, ghRepo)) {
      const parsed = parseReleaseTag(config, release.tag_name)
      if (parsed && deletedVersions.has(parsed.version)) {
        ops.deleteGitee?.(giteeToken, ghRepo, release, dryRun)
      }
    }
  }

  // Ontology mirror GitHub releases.
  for (const tag of ops.listGithubOntology(ghOntRepo)) {
    if (deletedVersions.has(config.ontologyVersion(tag))) {
      ops.deleteGithub(ghOntRepo, tag, dryRun)
    }
  }

  // Ontology mirror Gitee releases.
  if (giteeToken && ops.listGiteeOntology) {
    for (const release of ops.listGiteeOntology(giteeToken, ghOntRepo)) {
      if (deletedVersions.has(config.ontologyVersion(release.tag_name))) {
        ops.deleteGitee?.(giteeToken, ghOntRepo, release, dryRun)
      }
    }
  }

  return { deletedVersions, failures }
}
