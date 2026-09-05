import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import type { ConfigDumpLayer as OfficialConfigDumpLayer } from "@deepseek-ai/dsh-app-boot"
import {
  createPackageDshRuntimeApi,
  type DshRuntimeApi,
} from "../runtime/loader.js"
import {
  composePluginLayers,
  type PluginLayerPatch,
} from "../plugins/compose.js"

const require = createRequire(import.meta.url)

/**
 * The dump layer shape, identical to the official `ConfigDumpLayer` the
 * closure's `renderConfigDump` consumes; re-exported so the CLI's JSON
 * envelope stays in lockstep with the official layer contract.
 */
export type ConfigDumpLayer = OfficialConfigDumpLayer

/** The official loader patch row type, derived through the dump layer contract. */
type OfficialPatchOptions = OfficialConfigDumpLayer["patches"][number]

export interface ProfileDumpInput {
  dir: string
  patchPath: string
  layers: { packageName: string; patches: OfficialPatchOptions[] }[]
  patches: OfficialPatchOptions[]
}

export interface ComposeDshDumpLayersInput {
  profile: ProfileDumpInput
  pluginLayers: PluginLayerPatch[]
  /** Loader patch rows passed verbatim (the Bridge's builders emit them). */
  extraPatches: Record<string, unknown>[]
  /** Loader patch rows passed verbatim (the Bridge's builders emit them). */
  stateHomePatches: Record<string, unknown>[]
}

/**
 * Pure builder that assembles the config dump layers in the exact boot order:
 * bundle layers (label = packageName)
 * -> plugin layers (when non-empty, label = "ellamaka plugin layers (installed.json)", patches = [{ insert: pluginLayers }])
 * -> user patch layer (when non-empty, label = profile.patchPath, patches = profile.patches)
 * -> extra layers (when non-empty, label = "ellamaka bridge extra patches", patches = extraPatches)
 * -> state layers (when non-empty, label = "ellamaka state home patches", patches = stateHomePatches)
 */
export function composeDshDumpLayers(input: ComposeDshDumpLayersInput): ConfigDumpLayer[] {
  const layers: ConfigDumpLayer[] = []

  // 1. Bundle layers
  for (const layer of input.profile.layers) {
    layers.push({
      label: layer.packageName,
      patches: layer.patches,
    })
  }

  // 2. Plugin layers (only when non-empty)
  if (input.pluginLayers.length > 0) {
    layers.push({
      label: "ellamaka plugin layers (installed.json)",
      patches: [{ insert: input.pluginLayers }],
    })
  }

  // 3. User patch layer (only when non-empty)
  if (input.profile.patches.length > 0) {
    layers.push({
      label: input.profile.patchPath,
      patches: input.profile.patches,
    })
  }

  // 4. Bridge extra layer (when non-empty)
  if (input.extraPatches.length > 0) {
    layers.push({
      label: "ellamaka bridge extra patches",
      patches: input.extraPatches,
    })
  }

  // 5. State home layer (when non-empty)
  if (input.stateHomePatches.length > 0) {
    layers.push({
      label: "ellamaka state home patches",
      patches: input.stateHomePatches,
    })
  }

  return layers
}

/**
 * State home patch rows that give plugins an explicit home rooted under state/
 * (DESIGN-dsh-poc §3.4).
 */
export function stateHomePatches(stateDir: string): Record<string, unknown>[] {
  return [
    { id: "settings", config: { dshHome: stateDir } },
    { id: "credentials", config: { dshHome: stateDir } },
    { id: "attachment-local", config: { dshHome: stateDir } },
    { id: "shell-env", config: { dshHome: stateDir } },
    { id: "agent-instructions", config: { dshHome: stateDir, maxBytes: 65536 } },
    { id: "skill-filesystem", config: { dshHome: stateDir } },
    { id: "llm-deepseek", disabled: true },
    { id: "session-telemetry-otel", disabled: true },
  ]
}

export interface WebExtraPatchesOptions {
  disableCodeRuntime?: boolean
  extraPatches?: Record<string, unknown>[]
}

/**
 * Bridge extra patches for the web profile mount.
 *
 * `code-runtime` depends on node:module.stripTypeScriptTypes (Node 22.18+),
 * which the bun dev runtime lacks. It is a code-execution capability, not part
 * of the web UI chat surface. The CLI serve path (bun) disables it via
 * `disableCodeRuntime`; the Desktop sidecar (Node 22.18+) keeps it.
 *
 * `webserver`: the official webserver binds a real socket; the virtual profile
 * provides VirtualWebServer instead, so disable the real one.
 *
 * `web-runtime`: the iframe serves under /dsh; a root-path URL would be a
 * wrong entry point, so close web-runtime's URL printing and shell/prompt
 * injection. Full config replacement preserves the connection-trust fields.
 *
 * rc.1 no longer injects an `agent-presets` row: the preset roster is owned
 * by the official bundle (`default: standard` shipped set inside
 * `@deepseek-ai/dsh-agent-presets`, user root derived from the `dshHomePath`
 * service), so the host adds nothing here — the dump output matches the
 * official `dsh --dump-config` shape exactly.
 */
export function webExtraPatches(opts: WebExtraPatchesOptions): Record<string, unknown>[] {
  return [
    ...(opts.disableCodeRuntime ? [{ id: "code-runtime", disabled: true }] : []),
    { id: "webserver", disabled: true },
    {
      id: "web-runtime",
      config: { openBrowser: false, printUrl: false, surfaceContext: false, trustedHosts: [] },
    },
    ...(opts.extraPatches ?? []),
  ]
}

export interface ToolsExtraPatchesOptions {
  extraPatches?: Record<string, unknown>[]
}

/**
 * Bridge extra patches for the tools profile mount.
 *
 * `hmr`: HMR needs --expose-internals (bun lacks it); the tool surface has no
 * hot-reload need, so disable it to boot under bun.
 *
 * `tool-bash`: the per-call tool adapter context has no live session, so
 * background bash (which waits on session lifecycle) must stay off.
 */
export function toolsExtraPatches(opts?: ToolsExtraPatchesOptions): Record<string, unknown>[] {
  return [
    { id: "hmr", disabled: true },
    { id: "tool-bash", config: { enableRunInBackground: false } },
    ...(opts?.extraPatches ?? []),
  ]
}

export interface DumpDshConfigOptions {
  wopalHome?: string
  profileName: string
  defaultOnly?: boolean
  runtime?: DshRuntimeApi
  dshHome?: string
  installAnchor?: string
}

/** The JSON-envelope payload variant: the layer list without YAML rendering. */
export interface DshDumpPayload {
  schema: "ellamaka.dsh-dump-config/v1"
  profile: string
  defaultOnly: boolean
  layers: OfficialConfigDumpLayer[]
}

/**
 * Load a profile and compose its FULL dump layer list (bundle -> plugin ->
 * user -> extra -> state). The ONE composition both dump outputs share: the
 * YAML path renders it through the official `renderConfigDump`, the JSON
 * path emits it as the `DshDumpPayload.layers` — one composition, no drift.
 */
export async function composeDshDumpProfileLayers(options: DumpDshConfigOptions): Promise<{
  rootConfig: string
  layers: OfficialConfigDumpLayer[]
}> {
  const runtime = options.runtime ?? createPackageDshRuntimeApi()
  const wopalHome = options.wopalHome ?? process.env.WOPAL_HOME ?? join(homedir(), ".wopal")
  const dshHome = options.dshHome ?? join(wopalHome, "dsh")
  const stateDir = join(dshHome, "state")
  const installAnchor = realpathSync(
    options.installAnchor ?? require.resolve("@deepseek-ai/dsh/package.json"),
  )

  const profile = runtime.appBoot.loadProfile(
    "ellamaka",
    options.profileName,
    installAnchor,
    dshHome,
    { userLayer: options.defaultOnly === true ? false : undefined },
  )

  const rootConfig = join(profile.dir, "cordis.yml")
  // The dump anchors on the same empty root file the boot includes
  // (`renderConfigDump` readFileSync's it). Write it only when the content
  // differs: a running engine rebuilds its standing composition on mtime/size,
  // so a same-content write on the live home is not idempotent (B1.5 incident,
  // plan-b15-dump-config.md 事故教训). On the boot's own home the file is
  // already "[]\n", so this branch always skips.
  if (!existsSync(rootConfig) || readFileSync(rootConfig, "utf8") !== "[]\n") {
    writeFileSync(rootConfig, "[]\n")
  }

  const pluginLayers: PluginLayerPatch[] =
    options.defaultOnly === true
      ? []
      : composePluginLayers(dshHome, options.profileName, { installAnchor })

  let extra: Record<string, unknown>[] = []
  if (options.defaultOnly !== true) {
    if (options.profileName === "web") {
      extra = webExtraPatches({
        disableCodeRuntime: true,
      })
    } else if (options.profileName === "ellamaka-tools") {
      extra = toolsExtraPatches()
    }
  }

  const layers = composeDshDumpLayers({
    profile: {
      dir: profile.dir,
      patchPath: profile.patchPath,
      layers: profile.layers,
      patches: profile.patches,
    },
    pluginLayers,
    extraPatches: extra,
    stateHomePatches: options.defaultOnly === true ? [] : stateHomePatches(stateDir),
  })
  return { rootConfig, layers }
}

/**
 * Dump the effective dsh config patch stack for a profile.
 * Zero-state-write, boot-free diagnostic using official renderConfigDump.
 */
export async function dumpDshConfig(options: DumpDshConfigOptions): Promise<string> {
  const runtime = options.runtime ?? createPackageDshRuntimeApi()
  const { rootConfig, layers } = await composeDshDumpProfileLayers(options)
  return runtime.appBoot.renderConfigDump("ellamaka", rootConfig, layers)
}
