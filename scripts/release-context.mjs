// release-context.mjs — single workflow build/publish context
//
// Each release workflow checkouts a precise product tag, then assembles one
// release-context.json that the build, manifest, release-notes and upload
// steps all read. The context is not version-controlled; it lives in the
// workflow run only.
//
// See docs/RELEASE-IDENTITY.md §9.

import { buildNamespacedTag, parseNamespacedTag, parseReleaseVersion, buildReleaseIdentity } from "./release-identity.mjs"

/**
 * Build a release context from a namespaced tag + upstream lock + commit.
 *
 * The tag carries product/version/channel; the lock carries upstream; the
 * checkout carries the Ellamaka git commit; builtAt and workflowRunId come
 * from the workflow environment. No identity field can be overridden by
 * workflow input.
 */
export function buildReleaseContext({ tag, upstreamLock, gitCommit, workflowRunId, builtAt }) {
  const { product, version } = parseNamespacedTag(tag)
  const parsed = parseReleaseVersion(version)
  const channel = parsed.channel

  const identity = buildReleaseIdentity({
    product,
    version,
    channel,
    upstreamLock,
    gitCommit,
    builtAt,
    workflowRunId,
  })

  return {
    schemaVersion: 2,
    kind: "release",
    product,
    version,
    channel,
    upstream: identity.upstream,
    build: identity.build,
    // Source tag is the canonical trigger tag for this workflow run.
    sourceTag: buildNamespacedTag(product, version),
  }
}

/**
 * Serialize a release context to JSON for the workflow's release-context.json
 * artifact. The output is stable (no build metadata beyond what the identity
 * already carries).
 */
export function serializeReleaseContext(ctx) {
  return JSON.stringify(ctx, null, 2) + "\n"
}
