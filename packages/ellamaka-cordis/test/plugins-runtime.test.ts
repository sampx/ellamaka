import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context } from "@deepseek-ai/cordis"
import { bootDshWeb, bootDshTools, type DshWebHost, type DshToolsHost } from "../src/dsh-web"
import { startDshPluginService, type DshPluginServiceHandle } from "../src/plugins/runtime"
import { withProfileManifestWrite, appendBundle } from "../src/plugins/profile-manifest"
import { profileDirOf } from "../src/plugins/compose"

const FIXTURE_PLUGIN = join(import.meta.dir, "fixtures", "fixture-dsh-plugin")
const MARKER = "fixture-dsh-plugin.marker"

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "dsh-plugins-runtime-"))
}

/** The DshHost extension exposes the web container's ctx. */
function webCtxOf(web: DshWebHost): unknown {
  const ctx = (web as unknown as { ctx?: unknown }).ctx
  if (!ctx) throw new Error("web host did not expose ctx")
  return ctx
}

function marker(ctx: unknown): string | undefined {
  if (!ctx) return undefined
  return (ctx as { get(name: string, strict?: boolean): unknown }).get(MARKER, false) as string | undefined
}

/** Poll `probe` until it equals `want` (bun lacks expect.poll). */
async function waitFor(probe: () => string | undefined, want: string | undefined, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (probe() === want) return
    if (Date.now() > deadline) {
      throw new Error(`waitFor(${JSON.stringify(want)}) timed out; last value: ${JSON.stringify(probe())}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

/** Poll a counter until it reaches `want`. */
async function waitForCount(probe: () => number, want: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (probe() >= want) return
    if (Date.now() > deadline) throw new Error(`waitForCount(${want}) timed out; last: ${probe()}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function teardown(hosts: Array<{ dispose(): Promise<void> }>, home: string): Promise<void> {
  for (const host of hosts) {
    try {
      await host.dispose()
    } catch {
      // Teardown is best-effort.
    }
  }
  rmSync(home, { recursive: true, force: true })
}

/** Install the fixture plugin into BOTH profiles' manifests + node_modules. */
async function installFixture(home: string): Promise<void> {
  for (const profile of ["web", "ellamaka-tools"]) {
    const profileDir = profileDirOf(home, profile)
    mkdirSync(join(profileDir, "node_modules"), { recursive: true })
    rmSync(join(profileDir, "node_modules", "fixture-dsh-plugin"), { recursive: true, force: true })
    const { cpSync } = await import("node:fs")
    cpSync(FIXTURE_PLUGIN, join(profileDir, "node_modules", "fixture-dsh-plugin"), { recursive: true })
    await withProfileManifestWrite(profileDir, (manifest) => {
      appendBundle(manifest, "fixture-dsh-plugin")
    })
  }
}

/** Remove the fixture from both profiles (entity + manifest row). */
async function uninstallFixture(home: string): Promise<void> {
  for (const profile of ["web", "ellamaka-tools"]) {
    const profileDir = profileDirOf(home, profile)
    rmSync(join(profileDir, "node_modules", "fixture-dsh-plugin"), { recursive: true, force: true })
    await withProfileManifestWrite(profileDir, (raw) => {
      const dsh = (raw.dsh ??= {}) as Record<string, unknown>
      const profileSection = (dsh.profile ??= {}) as Record<string, unknown>
      const bundles = (profileSection.bundles ??= []) as string[]
      const index = bundles.indexOf("fixture-dsh-plugin")
      if (index !== -1) bundles.splice(index, 1)
    })
  }
}

describe("dsh plugin runtime service (profile composition files, event driven)", () => {
  test("installing a plugin while containers run hot-mounts it into both", async () => {
    const home = tempRoot()
    const web = await bootDshWeb({ home, port: 4097, disableCodeRuntime: true })
    const tools = await bootDshTools({ home, port: 0 })
    let updates = 0
    const service = startDshPluginService({ home, containers: [webContainer(web), toolsContainer(tools)], onReplay: () => updates++ })
    try {
      // CLI-side semantics: a pure disk operation on the composition files.
      await installFixture(home)
      await waitFor(() => marker(webCtxOf(web)), "mounted")
      await waitFor(() => marker(tools.ctx), "mounted")
      expect(updates).toBeGreaterThanOrEqual(2)
    } finally {
      await service.stop()
      await teardown([web, tools], home)
    }
  }, 90_000)

  test("a compose failure keeps the last good state and the NEXT real change recovers (no retry storm)", async () => {
    const home = tempRoot()
    const web = await bootDshWeb({ home, port: 4097, disableCodeRuntime: true })
    const tools = await bootDshTools({ home, port: 0 })
    const errors: Array<{ profile: string; error: unknown }> = []
    let updates = 0
    const service = startDshPluginService({
      home,
      containers: [webContainer(web), toolsContainer(tools)],
      onReplay: () => updates++,
      onReplayError: (profile, error) => errors.push({ profile, error }),
    })
    try {
      await installFixture(home)
      await waitFor(() => marker(webCtxOf(web)), "mounted")
      const settled = updates

      // Break the composition: a manifest bundle row whose package entity is
      // gone fails the recomposition loud (compose fail-loud semantics).
      rmSync(join(profileDirOf(home, "web"), "node_modules", "fixture-dsh-plugin", "package.json"))
      await withProfileManifestWrite(profileDirOf(home, "web"), (raw) => {
        const dsh = (raw.dsh ??= {}) as Record<string, unknown>
        const profileSection = (dsh.profile ??= {}) as Record<string, unknown>
        profileSection.bundles = [...((profileSection.bundles ?? []) as string[]), "phantom-broken-plugin"]
      })
      // The watcher fires (real change) and the replay FAILS.
      await waitForCount(() => errors.length, 1)
      // The last good state stays mounted despite the failure.
      expect(marker(webCtxOf(web))).toBe("mounted")

      // No retry storm: the failed hash is KEPT, so no further attempts fire
      // without another real change.
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const errorsAfterQuiet = errors.length
      const updatesAfterQuiet = updates
      expect(updatesAfterQuiet).toBe(settled)
      expect(errorsAfterQuiet).toBe(1)

      // Recovery: the next REAL change replays and the good state persists.
      await uninstallFixture(home)
      await waitForCount(() => errors.length, 2) // recovery replay fails on the phantom row...
      // ...then clear the phantom row: the next replay succeeds and clears.
      await withProfileManifestWrite(profileDirOf(home, "web"), (raw) => {
        const dsh = (raw.dsh ??= {}) as Record<string, unknown>
        const profileSection = (dsh.profile ??= {}) as Record<string, unknown>
        profileSection.bundles = ((profileSection.bundles ?? []) as string[]).filter((b) => b !== "phantom-broken-plugin")
      })
      await waitForCount(() => errors.length, 3)
      await waitForCount(() => updates, updatesAfterQuiet + 2)
      // The web container settled at the cleared composition.
      expect(marker(webCtxOf(web))).toBeUndefined()
    } finally {
      await service.stop()
      await teardown([web, tools], home)
    }
  }, 90_000)

  test("disabling a plugin in one profile leaves the other mounted", async () => {
    const home = tempRoot()
    const web = await bootDshWeb({ home, port: 4097, disableCodeRuntime: true })
    const tools = await bootDshTools({ home, port: 0 })
    const service = startDshPluginService({ home, containers: [webContainer(web), toolsContainer(tools)] })
    try {
      await installFixture(home)
      await waitFor(() => marker(webCtxOf(web)), "mounted")
      await waitFor(() => marker(tools.ctx), "mounted")

      // Remove the manifest bundle row for WEB only (disable semantics).
      await withProfileManifestWrite(profileDirOf(home, "web"), (raw) => {
        const dsh = (raw.dsh ??= {}) as Record<string, unknown>
        const profileSection = (dsh.profile ??= {}) as Record<string, unknown>
        profileSection.bundles = ((profileSection.bundles ?? []) as string[]).filter((b) => b !== "fixture-dsh-plugin")
      })
      await waitFor(() => marker(webCtxOf(web)), undefined)
      expect(marker(tools.ctx)).toBe("mounted")
    } finally {
      await service.stop()
      await teardown([web, tools], home)
    }
  }, 90_000)

  test("a replay update carries the FULL patch stack (official layers intact)", async () => {
    const home = tempRoot()
    const web = await bootDshWeb({ home, port: 4097, disableCodeRuntime: true })
    const tools = await bootDshTools({ home, port: 0 })
    const service = startDshPluginService({ home, containers: [webContainer(web), toolsContainer(tools)] })
    try {
      await installFixture(home)
      await waitFor(() => marker(webCtxOf(web)), "mounted")
      // The include config still carries official bundle rows after a replay.
      const config = (web.includeEntry as unknown as {
        options?: { config?: { patches?: { id?: string; name?: string }[] } }
      }).options?.config
      const names = (config?.patches ?? []).map((row) => row?.name).filter((n): n is string => typeof n === "string")
      expect(names.some((n) => n.startsWith("@deepseek-ai/"))).toBe(true)
      expect(names.some((n) => n === "fixture-dsh-plugin")).toBe(true)
    } finally {
      await service.stop()
      await teardown([web, tools], home)
    }
  }, 90_000)

  test("stop() is idempotent and settles in-flight replays", async () => {
    const home = tempRoot()
    const web = await bootDshWeb({ home, port: 4097, disableCodeRuntime: true })
    const tools = await bootDshTools({ home, port: 0 })
    const service = startDshPluginService({ home, containers: [webContainer(web), toolsContainer(tools)] })
    try {
      await service.stop()
      await service.stop()
      await service.stop()
      // Disk operations after stop never touch the containers.
      await installFixture(home)
      await new Promise((resolve) => setTimeout(resolve, 800))
      expect(marker(webCtxOf(web))).toBeUndefined()
      expect(marker(tools.ctx)).toBeUndefined()
    } finally {
      await teardown([web, tools], home)
    }
  }, 90_000)

  test("an unchanged composition short-circuits (no further include updates)", async () => {
    const home = tempRoot()
    const web = await bootDshWeb({ home, port: 4097, disableCodeRuntime: true })
    const tools = await bootDshTools({ home, port: 0 })
    let updates = 0
    const service = startDshPluginService({ home, containers: [webContainer(web), toolsContainer(tools)], onReplay: () => updates++ })
    try {
      await installFixture(home)
      await waitFor(() => marker(webCtxOf(web)), "mounted")
      const settled = updates
      await new Promise((resolve) => setTimeout(resolve, 1200))
      expect(updates).toBe(settled)
    } finally {
      await service.stop()
      await teardown([web, tools], home)
    }
  }, 90_000)
})

/** Containers wiring helpers (the mounted hosts carry profile + handles). */
function webContainer(web: DshWebHost) {
  return {
    profile: "web",
    ctx: webCtxOf(web),
    includeEntry: web.includeEntry,
    stackContext: web.stackContext,
  }
}

function toolsContainer(tools: DshToolsHost) {
  return {
    profile: "ellamaka-tools",
    ctx: tools.ctx,
    includeEntry: tools.includeEntry,
    stackContext: tools.stackContext,
  }
}

// Type-only silence.
export type { DshPluginServiceHandle }
