import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Decides whether the sidecar must run the one-time JSON → SQLite migration.
 *
 * The migration is only meaningful when a legacy JSON storage tree exists under
 * `$WOPAL_HOME/ellamaka/data/storage`. When that directory is absent the
 * sidecar's JsonMigration.run is a no-op, so we should neither show the loading
 * overlay nor ask the sidecar to run it.
 *
 * WOPAL_HOME resolution mirrors `@opencode-ai/core/global.ts`:
 * `process.env.WOPAL_HOME || ~/.wopal`.
 */
export function needsJsonMigration(
  env: { OPENCODE_DB?: string; WOPAL_HOME?: string } = process.env,
  wopalHome?: string,
): boolean {
  if (env.OPENCODE_DB === ":memory:") return false

  const home = wopalHome ?? env.WOPAL_HOME ?? join(homedir(), ".wopal")
  return existsSync(join(home, "ellamaka", "data", "storage"))
}