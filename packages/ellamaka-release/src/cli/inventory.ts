// packages/ellamaka-release/src/cli/inventory.ts
//
// Thin CLI entry for legacy inventory capture. Replaces
// scripts/capture-legacy-release-inventory.mjs.
//
// Usage:
//   bun packages/ellamaka-release/src/cli/inventory.ts --dry-run
//   bun packages/ellamaka-release/src/cli/inventory.ts --output release/legacy-inventory.json

import { main } from "../inventory"

if (import.meta.main) {
  try {
    main()
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`)
    process.exit(1)
  }
}
