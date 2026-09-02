import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bootDshWeb, bootDshTools, type DshWebHost, type DshToolsHost } from "../src/dsh-web"
import { startDshPluginService, type DshPluginServiceHandle } from "../src/plugins/runtime"
import { readStore, setEnabled, writeStore, type DshPluginStoreV1 } from "../src/plugins/store"
import { installPackage, removePackage } from "../src/plugins/installer"

const FIXTURE_PLUGIN = join(import.meta.dir, "fixtures", "fixture-dsh-plugin")
const MARKER = "fixture-dsh-plugin.marker"

/** Boot the web+tools pair against a temp home (dsh-web.test.ts pattern). */
async function bootPair() {
  const home = mkdtempSync(join(tmpdir(), "dsh-plugins-runtime-"))
  const web = await bootDshWeb({ home, port: 4097, disableCodeRuntime: true })
  const tools = await bootDshTools({ home, port: 0 })
  return { home, web, tools }
}

/** Containers wiring for the service, derived from the mounted hosts. */
function containersFor(web: DshWebHost, tools: DshToolsHost) {
  return [
    {
      profile: "web",
      ctx: (web as unknown as { ctx?: unknown }).ctx,
      includeEntry: requireIncludeEntry(web, "web"),
      stackContext: web.stackContext,
    },
    {
      profile: "ellamaka-tools",
      ctx: tools.ctx,
      includeEntry: requireIncludeEntry(tools, "ellamaka-tools"),
      stackContext: tools.stackContext,
    },
  ]
}

function requireIncludeEntry(host: unknown, label: string): { id: string; update(options: unknown): Promise<void> } {
  const entry = (host as { includeEntry?: { id: string; update(options: unknown): Promise<void> } }).includeEntry
  if (!entry) throw new Error(`${label} host did not expose includeEntry`)
  return entry
}

function marker(ctx: unknown): string | undefined {
  if (!ctx) return undefined
  return (ctx as { get(name: string, strict?: boolean): unknown }).get(MARKER, false) as string | undefined
}

/** Poll `probe` until it equals `want` (bun lacks expect.poll). */
async function waitFor(probe: () => string | undefined, want: string | undefined, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (probe() === want) return
    if (Date.now() > deadline) {
      throw new Error(`waitFor(${JSON.stringify(want)}) timed out; last value: ${JSON.stringify(probe())}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function teardown(web: DshWebHost, tools: DshToolsHost, home: string): Promise<void> {
  try {
    await web.dispose()
  } finally {
    await tools.dispose()
    rmSync(home, { recursive: true, force: true })
  }
}

describe("dsh plugin runtime service (real closure integration)", () => {
  test("installing a plugin while containers run hot-mounts it into both", async () => {
    const { home, web, tools } = await bootPair()
    const containers = containersFor(web, tools)
    let updates = 0
    const service = startDshPluginService({ home, containers, intervalMs: 200, onReplay: () => updates++ })
    try {
      // CLI-side semantics: a pure disk operation (installer writes dir + store).
      const result = await installPackage({ kind: "dir", path: FIXTURE_PLUGIN }, { home, enabledIn: ["web", "ellamaka-tools"] })
      expect(result.isBundle).toBe(true)

      // Within the poll window both containers expose the fixture service.
      await waitFor(() => marker(webCtxOf(web)), "mounted")
      await waitFor(() => marker(tools.ctx), "mounted")
      expect(updates).toBeGreaterThanOrEqual(2)
    } finally {
      await service.stop()
      await teardown(web, tools, home)
    }
  }, 60_000)

  test("disable removes the service from one container only", async () => {
    const { home, web, tools } = await bootPair()
    const containers = containersFor(web, tools)
    const service = startDshPluginService({ home, containers, intervalMs: 200 })
    try {
      await installPackage({ kind: "dir", path: FIXTURE_PLUGIN }, { home, enabledIn: ["web", "ellamaka-tools"] })
      await waitFor(() => marker(webCtxOf(web)), "mounted")
      await waitFor(() => marker(tools.ctx), "mounted")

      // Store-side disable for web only (CLI `disable` semantics).
      const store = readStore(home)
      await writeStore(home, setEnabled(store, "fixture-dsh-plugin", "web", false))

      await waitFor(() => marker(webCtxOf(web)), undefined)
      expect(marker(tools.ctx)).toBe("mounted")
    } finally {
      await service.stop()
      await teardown(web, tools, home)
    }
  }, 60_000)

  test("remove unwinds effects in both containers", async () => {
    const { home, web, tools } = await bootPair()
    const service = startDshPluginService({ home, containers: containersFor(web, tools), intervalMs: 200 })
    try {
      await installPackage({ kind: "dir", path: FIXTURE_PLUGIN }, { home, enabledIn: ["web", "ellamaka-tools"] })
      await waitFor(() => marker(webCtxOf(web)), "mounted")
      await waitFor(() => marker(tools.ctx), "mounted")

      await removePackage("fixture-dsh-plugin", { home })

      await waitFor(() => marker(webCtxOf(web)), undefined)
      await waitFor(() => marker(tools.ctx), undefined)
    } finally {
      await service.stop()
      await teardown(web, tools, home)
    }
  }, 60_000)

  test("a bad replay keeps the last good state, logs structured, and the service survives (rook W-02)", async () => {
    const { home, web, tools } = await bootPair()
    const logs: Array<{ message: string; extra?: Record<string, unknown> }> = []
    const service = startDshPluginService({
      home,
      containers: containersFor(web, tools),
      intervalMs: 200,
      logger: {
        info: () => {},
        warn: () => {},
        error: (message, extra) => logs.push({ message, extra }),
      },
    })
    try {
      // Install the GOOD plugin first and let it mount.
      await installPackage({ kind: "dir", path: FIXTURE_PLUGIN }, { home, enabledIn: ["web", "ellamaka-tools"] })
      await waitFor(() => marker(webCtxOf(web)), "mounted")

      // Break the install area so the next replay cannot import the plugin,
      // then change the store so the watcher re-attempts (a broken install
      // whose entry is enabled must fail the include update and log).
      rmSync(join(home, "plugins", "fixture-dsh-plugin"), { recursive: true, force: true })
      const store = readStore(home)
      store.plugins.push({
        name: "phantom-broken-plugin",
        version: "1.0.0",
        source: "dir",
        enabledIn: ["web", "ellamaka-tools"],
        installedAt: "2026-09-02T00:00:00.000Z",
      })
      await writeStore(home, store)
      await new Promise((resolve) => setTimeout(resolve, 1200))

      // Structured failure log: fixed message + { profile, hash, error }.
      const failure = logs.find((l) => l.message.includes("replay failed"))
      expect(failure).toBeDefined()
      expect(failure?.extra?.profile).toBe("web")
      expect(failure?.extra?.hash).toBeTypeOf("string")
      expect(String(failure?.extra?.error).length).toBeGreaterThan(0)

      // The last good state stayed mounted (the good plugin never dropped).
      expect(marker(webCtxOf(web))).toBe("mounted")
      expect(marker(tools.ctx)).toBe("mounted")

      // Recovery: restore the install dir + drop the phantom entry; the next
      // replay succeeds and the service never crashed.
      cpSync(FIXTURE_PLUGIN, join(home, "plugins", "fixture-dsh-plugin", "1.0.0"), { recursive: true })
      const fixed = readStore(home)
      fixed.plugins = fixed.plugins.filter((p) => p.name === "fixture-dsh-plugin")
      await writeStore(home, fixed)
      await waitFor(() => marker(webCtxOf(web)), "mounted")
      await waitFor(() => marker(tools.ctx), "mounted")
    } finally {
      await service.stop()
      await teardown(web, tools, home)
    }
  }, 60_000)

  test("an unchanged store short-circuits (no further include updates)", async () => {
    const { home, web, tools } = await bootPair()
    const containers = containersFor(web, tools)
    let updates = 0
    const service = startDshPluginService({ home, containers, intervalMs: 150, onReplay: () => updates++ })
    try {
      await installPackage({ kind: "dir", path: FIXTURE_PLUGIN }, { home, enabledIn: ["web", "ellamaka-tools"] })
      await waitFor(() => marker(webCtxOf(web)), "mounted")
      const settled = updates
      await new Promise((resolve) => setTimeout(resolve, 800))
      expect(updates).toBe(settled)
    } finally {
      await service.stop()
      await teardown(web, tools, home)
    }
  }, 60_000)
})

/** The DshHost extension exposes the web container's ctx. */
function webCtxOf(web: DshWebHost): unknown {
  const ctx = (web as unknown as { ctx?: unknown }).ctx
  if (!ctx) throw new Error("web host did not expose ctx")
  return ctx
}

// Type-only silence: DshPluginServiceHandle is exercised via startDshPluginService.
export type { DshPluginServiceHandle, DshPluginStoreV1 }
void existsSync
