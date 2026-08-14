// packages/ellamaka-release/src/cli/upstream-lock.ts
//
// Thin CLI entry for upstream lock updates. Replaces
// scripts/update-upstream-lock.mjs.
//
// Usage:
//   bun packages/ellamaka-release/src/cli/upstream-lock.ts engine --version 1.18.10 [--dry-run]

import { run } from "../upstream-lock"

if (import.meta.main) {
  try {
    run()
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`)
    process.exit(1)
  }
}
