import { describe, expect, test } from "bun:test"
import { mkdtempSync, existsSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { Context } from "@deepseek-ai/cordis"
import { mountDshWeb, mountDshTools } from "../src/dsh-web"

/**
 * dsh runtime isolation (DESIGN-dsh-poc §3.4): every dsh engine runtime byte
 * (settings/sessions/storages/credentials) lands under `$WOPAL_HOME/dsh/state`,
 * NOT `~/.dsh`. Purely via config injection — `process.env.DSH_HOME` is never
 * set.
 */

describe("dsh runtime isolation", () => {
  test("never sets process.env.DSH_HOME", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-isolate-env-"))
    const ctx = new Context()
    const host = await mountDshWeb(ctx, { home, port: 4097, disableCodeRuntime: true })
    try {
      expect(process.env.DSH_HOME).toBeUndefined()
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
    }
  }, 30_000)

  test("settings runtime file lands in state/ not ~/.dsh", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-isolate-settings-"))
    const ctx = new Context()
    const host = await mountDshWeb(ctx, { home, port: 4097, disableCodeRuntime: true })
    try {
      // The settings service is mounted; a namespaced update persists through
      // the file provider to `<state>/settings.yaml`.
      const settings = ctx.get("settings") as
        | { update(ns: string, patch: unknown): Promise<unknown> }
        | undefined
      expect(settings).toBeDefined()

      await settings!.update("agent-default-model", { provider: "test-provider" })

      // Wait a tick for the async persist to flush to disk.
      await new Promise((r) => setTimeout(r, 300))

      const stateSettings = join(home, "state", "settings.yaml")
      expect(existsSync(stateSettings)).toBe(true)

      // The written document lives under the closure's state/ dir — never the
      // user's default ~/.dsh home. The home dir for this mount is a temp dir,
      // so its settings cannot be under the user's real home.
      expect(stateSettings.startsWith(join(homedir(), ".dsh"))).toBe(false)
      expect(stateSettings.startsWith(home)).toBe(true)
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
    }
  }, 30_000)

  test("tools profile still overrides ctx dshHomePath to state/", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-isolate-tools-"))
    const ctx = new Context()
    const host = await mountDshTools(ctx, { home, port: 0 })
    try {
      // The tools profile disables the agent-loop rows (incl. `settings`), so
      // there is no settings persistence to redirect; the A-type ctx override
      // still applies for any `!!js dshHomePath(...)` the tool bundle uses.
      const injected = ctx.get("dshHomePath") as ((...s: string[]) => string) | undefined
      expect(injected).toBeDefined()
      expect(injected!("sessions")).toBe(join(home, "state", "sessions"))
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
    }
  }, 30_000)

  test("ctx dshHomePath override resolves storages/sessions under state/", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-isolate-dshhomepath-"))
    const ctx = new Context()
    const host = await mountDshWeb(ctx, { home, port: 4097, disableCodeRuntime: true })
    try {
      // The ctx-injected dshHomePath is what `!!js dshHomePath('sessions')`
      // expressions evaluate. Reading it directly proves the override is in
      // place and rooted at state/.
      const injected = ctx.get("dshHomePath") as ((...s: string[]) => string) | undefined
      expect(injected).toBeDefined()
      expect(injected!("sessions")).toBe(join(home, "state", "sessions"))
      expect(injected!("storages")).toBe(join(home, "state", "storages"))
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
    }
  }, 30_000)
})
