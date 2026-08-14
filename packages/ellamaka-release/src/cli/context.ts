// packages/ellamaka-release/src/cli/context.ts
//
// Thin CLI entry for assembling a release-context.json from a namespaced tag
// + upstream lock + git commit + workflow run id. Replaces the inline
// `node -e` release-context assembly in the publish workflows.
//
// Usage:
//   bun packages/ellamaka-release/src/cli/context.ts \
//     --tag "$GITHUB_REF_NAME" \
//     --git-commit "$GITHUB_SHA" \
//     --workflow-run-id "$GITHUB_RUN_ID" \
//     [--output release-context.json] \
//     [--lock release/upstreams.lock.json]

import fs from "fs"
import path from "path"
import { buildReleaseContext, serializeReleaseContext } from "../context"
import { loadUpstreamLock } from "../identity"

function parseArgs(argv: string[]) {
  const flags: Record<string, string | undefined> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith("--")) continue
    const key = arg.slice(2)
    if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
      flags[key] = argv[++i]!
    } else {
      flags[key] = "true"
    }
  }
  return flags
}

function main() {
  const flags = parseArgs(process.argv.slice(2))
  const tag = flags.tag
  const gitCommit = flags["git-commit"]
  const workflowRunId = flags["workflow-run-id"]
  const output = flags.output ?? "release-context.json"
  const lockPath = flags.lock ?? "release/upstreams.lock.json"

  if (!tag) throw new Error("Missing required flag: --tag")
  if (!gitCommit) throw new Error("Missing required flag: --git-commit")
  if (!workflowRunId) throw new Error("Missing required flag: --workflow-run-id")

  const upstreamLock = loadUpstreamLock(path.resolve(lockPath))
  const builtAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
  const ctx = buildReleaseContext({
    tag,
    upstreamLock,
    gitCommit,
    workflowRunId,
    builtAt,
  })

  fs.writeFileSync(output, serializeReleaseContext(ctx))
  console.log(`Generated ${output} for ${tag}`)
}

if (import.meta.main) {
  try {
    main()
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`)
    process.exit(1)
  }
}
