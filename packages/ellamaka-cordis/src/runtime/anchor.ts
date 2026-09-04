import { dirname, join } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

/**
 * Shipped agent-preset root, beside the `@deepseek-ai/dsh` install anchor's
 * own config (`config/agent-presets/`). Carries the built-in `standard` preset
 * (and friends) the web UI defaults to. Mirrors how the dsh CLI's
 * `composeProfile` assembles the SHIPPED root — `loadProfile` alone does not.
 *
 * Resolved lazily from the given install anchor (or, when omitted, this
 * module's own closure): the root must track the anchor the mount actually
 * resolves the dsh packages from — a bundled host (packaged CLI, Desktop
 * sidecar) passes the materialised closure copy under `$WOPAL_HOME/dsh`
 * (DESIGN-dsh-poc §2.2), and a module-load-time constant would silently
 * point at the wrong closure or crash the whole module on resolve.
 */
export function shippedPresetRoot(installAnchor?: string): string {
  const anchor = installAnchor ?? require.resolve("@deepseek-ai/dsh/package.json")
  return join(dirname(anchor), "config", "agent-presets")
}
