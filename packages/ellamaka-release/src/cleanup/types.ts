// packages/ellamaka-release/src/cleanup/types.ts
//
// Shared types for the cleanup kernel.

import type { ReleaseChannel } from "../identity"

export type ProductConfig = {
  product: "ellamaka-cli" | "ellamaka-desktop"
  channels: ReleaseChannel[]
  r2Root: string
  betaRoot: string | null
  latestAlias: string
  aliasNames: string[]
  /** Restore strategy for a withdrawn latest alias. */
  ontologyRestore: "alias" | "latest-channel"
  githubRepo: string
  githubTagPrefix: string

  // --- R2 path resolution (product-aware) ---
  /** R2 root prefix for a given channel. */
  rootForChannel: (channel: ReleaseChannel) => string
  /** Extract the version from a versioned R2 path (or null if not a versioned path). */
  versionFromPath: (p: string) => string | null
  /** Derive the channel from a versioned R2 path. */
  channelFromPath: (p: string) => ReleaseChannel
  /** Build the versioned R2 path for a version/channel. */
  pathForVersion: (version: string, channel: ReleaseChannel) => string
  /** The latest alias prefix for a channel. */
  latestPrefixForChannel: (channel: ReleaseChannel) => string
  /** The latest manifest alias key for a channel. */
  aliasKeyForChannel: (channel: ReleaseChannel) => string
  /** Map an alias key to its channel, or null if the alias is not this product's. */
  channelForAlias: (alias: string) => ReleaseChannel | null

  // --- ontology mirror (product-aware) ---
  /** jq `select` expression for GitHub ontology releases. */
  githubOntologySelect: string
  /** Whether a tag belongs to this product's ontology mirror. */
  isOntologyTag: (tag: string) => boolean
  /** Extract the version from this product's ontology mirror tag. */
  ontologyVersion: (tag: string) => string
}

export type ReleaseSnapshot = {
  versionedPaths: string[]
  tags: string[]
}

export type AliasMap = Record<string, string>

export type ReferenceGraph = {
  protected: Set<string>
  protectedReason: Map<string, string>
  legacy: Set<string>
  standard: Set<string>
}

export type RetentionCandidate = {
  version: string
  path: string
  protected: boolean
}

export type RetentionPlan = {
  deleteCandidates: RetentionCandidate[]
  legacyRetained: string[]
  dryRun: boolean
}

export type WithdrawStep = { action: string; target: string }

export type WithdrawPlan = {
  allowed: boolean
  reason?: string
  steps: WithdrawStep[]
}
