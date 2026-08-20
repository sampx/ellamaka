import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context } from "@deepseek-ai/cordis"
import { bootDshWeb, mountDshWeb } from "../src/dsh-web"

/**
 * Mount the dsh web engine on a second loopback port (final scheme, PoC §7.11).
 * Uses a temp DSH_HOME so the test never touches the user's ~/.dsh.
 */
describe("dsh web engine", () => {
  test("mountDshWeb mounts onto an existing context and disposes cleanly", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-host-"))
    const ctx = new Context()
    const host = await mountDshWeb(ctx, { home, port: 0 })

    try {
      // The dsh native webserver reports the OS-assigned port.
      expect(host.port).toBeGreaterThan(0)
      expect(host.url).toBe(`http://127.0.0.1:${host.port}`)

      // The web UI is served (dsh index fallback + boot manifest).
      const root = await fetch(host.url)
      expect(root.status).toBe(200)
      const html = await root.text()
      expect(html).toContain("__DSH_BOOT__")

      // The /api RPC channel is alive.
      const rpc = await fetch(`${host.url}/api/host.describe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(rpc.status).toBe(200)

      // The SHIPPED agent-preset root is assembled, so the default `standard`
      // preset is discoverable (without it the roster is empty and sessions
      // cannot start).
      const presets = await ctx.agentPresets.list()
      expect(presets.map((p) => p.id)).toContain("standard")
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
    }
  }, 30_000)

  test("bootDshWeb owns a fresh context and disposes it", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-host-"))
    const host = await bootDshWeb({ home, port: 0 })

    try {
      expect(host.port).toBeGreaterThan(0)
      const root = await fetch(host.url)
      expect(root.status).toBe(200)
    } finally {
      await host.dispose()
    }
  }, 30_000)

  test("mountDshWeb writes dsh plugin logs to the dedicated log file", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-host-"))
    const logFile = join(home, "dsh-plugins.log")
    const ctx = new Context()
    const host = await mountDshWeb(ctx, { home, port: 0, logFile })

    try {
      // The dsh engine boots a webServer service; its startup logs should
      // land in the dedicated file via the registered Exporter.
      const root = await fetch(host.url)
      expect(root.status).toBe(200)
      // Emit a log through the host context's logger — the Exporter routes it
      // to the dedicated file (dsh plugins log via the same ctx.logger path).
      ctx.logger("dsh-web-test").info("exporter probe")
      // Give the async Exporter a tick to flush.
      await new Promise((r) => setTimeout(r, 200))
      const content = readFileSync(logFile, "utf-8")
      expect(content).toContain("exporter probe")
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
    }
  }, 30_000)
})
