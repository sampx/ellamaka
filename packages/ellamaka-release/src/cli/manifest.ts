// packages/ellamaka-release/src/cli/manifest.ts
//
// Thin CLI entry for release manifest generation. Replaces
// scripts/package-release.mjs.
//
// Usage:
//   bun packages/ellamaka-release/src/cli/manifest.ts manifest \
//     --archives-dir dist \
//     --output-dir release-output \
//     --release-context-path release-context.json \
//     [--base-url ...]

import { parseArgs, manifestCommand } from "../manifest"

if (import.meta.main) {
  try {
    const parsed = parseArgs(process.argv)
    manifestCommand(parsed.flags)
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`)
    process.exit(1)
  }
}
