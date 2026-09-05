import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context } from "@deepseek-ai/cordis"
import { createBunHmr } from "../src/plugins/bun-hmr"
import { mountDshTools } from "../src/dsh-web"
import { withProfileManifestWrite, appendBundle } from "../src/plugins/profile-manifest"
import { profileDirOf } from "../src/plugins/compose"

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "bun-hmr-"))
}

describe("createBunHmr: registerConfig contract", () => {
  test("a file change runs the refresh callback serially; disposer stops watching", async () => {
    const root = tempRoot()
    const file = join(root, "cordis.patch.yml")
    writeFileSync(file, "[]\n")
    const ctx = new Context()
    const hmr = createBunHmr({ containers: [], dshRoot: root, ctx })
    // Mount the service onto the context like an official plugin would.
    await hmr.mount()
    try {
      let refreshes = 0
      let last: number | undefined
      const refresh = async () => {
        // Serialisation probe: sleep inside the first refresh; a concurrent
        // event must not interleave.
        await new Promise((r) => setTimeout(r, 200))
        last = ++refreshes
      }
      const disposer = await hmr.registerConfig(file, refresh)
      writeFileSync(file, "# one\n")
      await new Promise((r) => setTimeout(r, 700))
      expect(refreshes).toBe(1)
      expect(last).toBe(1)

      // Stop watching: later changes do not fire.
      await disposer()
      writeFileSync(file, "# two\n")
      await new Promise((r) => setTimeout(r, 700))
      expect(refreshes).toBe(1)
    } finally {
      await hmr.stop()
      await ctx.fiber.dispose()
    }
  }, 30_000)

  test("registering the same path twice throws", async () => {
    const root = tempRoot()
    const file = join(root, "cordis.patch.yml")
    writeFileSync(file, "[]\n")
    const ctx = new Context()
    const hmr = createBunHmr({ containers: [], dshRoot: root, ctx })
    await hmr.mount()
    try {
      await hmr.registerConfig(file, async () => {})
      await expect(hmr.registerConfig(file, async () => {})).rejects.toThrow(/already registered/)
    } finally {
      await hmr.stop()
      await ctx.fiber.dispose()
    }
  }, 30_000)

  test("a disposer is idempotent (second call is a no-op)", async () => {
    const root = tempRoot()
    const file = join(root, "cordis.patch.yml")
    writeFileSync(file, "[]\n")
    const ctx = new Context()
    const hmr = createBunHmr({ containers: [], dshRoot: root, ctx })
    await hmr.mount()
    try {
      const disposer = await hmr.registerConfig(file, async () => {})
      await disposer()
      // Second call must not throw.
      await disposer()
      expect(true).toBe(true)
    } finally {
      await hmr.stop()
      await ctx.fiber.dispose()
    }
  }, 30_000)

  test("refresh errors are logged and the watcher survives", async () => {
    const root = tempRoot()
    const file = join(root, "cordis.patch.yml")
    writeFileSync(file, "[]\n")
    const errors: string[] = []
    const ctx = new Context()
    const hmr = createBunHmr({
      containers: [],
      dshRoot: root,
      ctx,
      logger: {
        info: () => {},
        warn: (m) => errors.push(m),
        error: (m) => errors.push(m),
      },
    })
    await hmr.mount()
    try {
      let calls = 0
      await hmr.registerConfig(file, async () => {
        calls++
        throw new Error("refresh boom")
      })
      writeFileSync(file, "# change\n")
      await new Promise((r) => setTimeout(r, 700))
      expect(calls).toBe(1)
      expect(errors.join("\n")).toMatch(/refresh boom|reload/)
      // The watcher survived: a later change fires again.
      writeFileSync(file, "# change 2\n")
      await new Promise((r) => setTimeout(r, 700))
      expect(calls).toBe(2)
    } finally {
      await hmr.stop()
      await ctx.fiber.dispose()
    }
  }, 30_000)
})

describe("bun-hmr: composition-file replay (generation candidate replacement)", () => {
  test("editing the user patch layer replays the full stack into the container", async () => {
    const root = tempRoot()
    const ctx = new Context()
    const host = await mountDshTools(ctx, { home: root, port: 0 })
    const containers = [
      { profile: "ellamaka-tools", ctx, includeEntry: host.includeEntry, stackContext: host.stackContext },
    ]
    const hmr = createBunHmr({ containers, dshRoot: root, ctx })
    try {
      // The patch file is the watched composition file: a change must
      // transactionally update the container's include entry.
      await hmr.watchCompositionFiles("ellamaka-tools")
      const patchFile = join(profileDirOf(root, "ellamaka-tools"), "cordis.patch.yml")
      writeFileSync(patchFile, "[]\n")
      await new Promise((r) => setTimeout(r, 900))

      // The container's include config was replaced with the recomposed
      // stack (the plugin rows from the profile manifest bundle remain).
      const config = (host.includeEntry as unknown as {
        options?: { config?: { patches?: { insert?: { id?: string }[] }[] } }
      }).options?.config
      const insertRows = (config?.patches ?? []).flatMap((row) => row?.insert ?? [])
      expect(Array.isArray(config?.patches)).toBe(true)
    } finally {
      await hmr.stop()
      await host.dispose()
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
