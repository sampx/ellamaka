// Pure helpers for the chat composer sandbox tri-state control (Plan: feature-dsh
// escalation/sandbox, Task 3). The dsh-adapter plugin carries an inline `sandbox`
// option in its config spec; the composer exposes it as three presets:
//   read-only        → { enabled: true, mode: "read-only" }
//   workspace-write  → { enabled: true, mode: "workspace-write" }
//   full-access      → { enabled: false } (sandbox off; adapter default)
// Specs follow ConfigPlugin.Spec: a plugin is either a string url or a
// [url, options] tuple, and `plugin` is an array of such specs.

export type SandboxPreset = "read-only" | "workspace-write" | "full-access"

export type SandboxOptions = {
  enabled: boolean
  mode?: string
}

export type PluginSpec = string | [string, Record<string, unknown>]

export const SANDBOX_PRESETS: SandboxPreset[] = ["read-only", "workspace-write", "full-access"]

const DSH_ADAPTER_MARKER = "dsh-adapter"

export function sandboxToPreset(cfg?: SandboxOptions): SandboxPreset {
  if (!cfg?.enabled) return "full-access"
  if (cfg.mode === "read-only") return "read-only"
  return "workspace-write"
}

export function presetToSandbox(preset: SandboxPreset): SandboxOptions {
  if (preset === "full-access") return { enabled: false }
  return { enabled: true, mode: preset }
}

export function isSandboxPreset(value: unknown): value is SandboxPreset {
  return typeof value === "string" && (SANDBOX_PRESETS as string[]).includes(value)
}

function isTupleSpec(spec: PluginSpec): spec is [string, Record<string, unknown>] {
  return Array.isArray(spec)
}

function specUrl(spec: PluginSpec): string {
  return isTupleSpec(spec) ? spec[0] : spec
}

function isDshAdapterSpec(spec: PluginSpec): boolean {
  return specUrl(spec).includes(DSH_ADAPTER_MARKER)
}

export function hasDshAdapterPlugin(plugins: PluginSpec[] | undefined): boolean {
  if (!plugins) return false
  return plugins.some(isDshAdapterSpec)
}

export function readDshAdapterSandbox(plugins: PluginSpec[] | undefined): SandboxOptions | undefined {
  const spec = plugins?.find(isDshAdapterSpec)
  if (!spec || !isTupleSpec(spec)) return undefined
  const options = spec[1]
  const sandbox = options?.sandbox
  if (typeof sandbox !== "object" || sandbox === null) return undefined
  const record = sandbox as Record<string, unknown>
  if (typeof record.enabled !== "boolean") return undefined
  return {
    enabled: record.enabled,
    ...(typeof record.mode === "string" ? { mode: record.mode } : {}),
  }
}

export function patchDshAdapterSandbox(
  plugins: PluginSpec[],
  sandbox: SandboxOptions,
): PluginSpec[] | undefined {
  const index = plugins.findIndex(isDshAdapterSpec)
  if (index < 0) return undefined
  const next = [...plugins]
  const spec = plugins[index]
  // The adapter's `sandbox` inline option is owned by this control: patching
  // rewrites only that key and leaves every other option field as-is.
  const options: Record<string, unknown> = isTupleSpec(spec) ? { ...spec[1] } : {}
  options.sandbox = sandbox === undefined ? undefined : { ...sandbox }
  if (!isTupleSpec(spec)) {
    next[index] = [spec, options]
  } else {
    next[index] = [spec[0], options]
  }
  return next
}