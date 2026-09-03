// cli/version-line.ts — thin CLI entry: parse argv → call library → exit code.
// Usage: bun packages/ellamaka-release/src/cli/version-line.ts <line> <anchor> <channel> [explicit]

import { inferNextVersion } from "../version-line"

const [line, anchor, channel, explicit] = process.argv.slice(2)

if (!line || !anchor || !channel) {
  console.error("usage: version-line.ts <line> <anchor> <stable|rc|beta|minor|major> [explicit-version]")
  process.exit(2)
}

try {
  process.stdout.write(inferNextVersion({ line, anchor }, channel as never, explicit || undefined))
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}
