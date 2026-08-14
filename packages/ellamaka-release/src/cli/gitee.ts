// packages/ellamaka-release/src/cli/gitee.ts
//
// Thin CLI entry for Gitee release creation. Replaces
// scripts/create-gitee-release.mjs.

import { main } from "../gitee"

if (import.meta.main) {
  main().catch((err) => {
    console.error(`Error: ${(err as Error).message}`)
    process.exit(1)
  })
}
