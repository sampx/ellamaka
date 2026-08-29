import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mountDshIfEnabled } from "@/cli/cmd/tui/dsh-mount"

const CONTAINER_KEY = "__ellamakaDshContainer"

type ToolContainer = {
  get(name: "tools"): {
    execute(exec: unknown): Promise<{ isError: boolean; content?: { type: string; text?: string }[] }>
  }
  get(name: "sessions"): { list(): unknown[] } | undefined
}

describe("tui dsh mount", () => {
  afterEach(() => {
    delete process.env.ELLAMAKA_DSH
    delete (globalThis as Record<string, unknown>)[CONTAINER_KEY]
  })

  test("returns undefined when ELLAMAKA_DSH is disabled (kill switch =0)", async () => {
    process.env.ELLAMAKA_DSH = "0"
    const handle = await mountDshIfEnabled()
    expect(handle).toBeUndefined()
    expect((globalThis as Record<string, unknown>)[CONTAINER_KEY]).toBeUndefined()
  })

  test("mounts the tool container and executes grep without a live session", async () => {
    process.env.ELLAMAKA_DSH = "1"
    const home = mkdtempSync(join(tmpdir(), "dsh-tui-mount-"))
    const handle = await mountDshIfEnabled({ home, logFile: join(home, "dsh-plugins.log") })
    expect(handle).toBeDefined()

    try {
      const container = (globalThis as Record<string, unknown>)[CONTAINER_KEY] as ToolContainer
      expect(container).toBeDefined()

      const ws = mkdtempSync(join(tmpdir(), "dsh-tui-ws-"))
      for (let i = 0; i < 400; i++) {
        writeFileSync(join(ws, `f${i}.txt`), `needle line ${i}\n`)
      }

      const tools = container.get("tools")
      const facade = { session: { header: { id: `tui-${Date.now()}`, cwd: ws } } }
      const result = await tools.execute({
        callId: "tui-mount-call",
        name: "grep",
        arguments: { pattern: "needle", path: ws },
        signal: new AbortController().signal,
        agent: facade,
      })
      const text = (result.content ?? []).map((b) => b.text ?? "").join("\n")
      expect(result.isError).toBe(false)
      expect(text).toContain("250 of 400")

      const sessions = container.get("sessions")
      expect(sessions?.list() ?? []).toEqual([])
    } finally {
      await handle!.dispose()
    }
  }, 60_000)

  test("dispose clears the global container", async () => {
    process.env.ELLAMAKA_DSH = "1"
    const home = mkdtempSync(join(tmpdir(), "dsh-tui-mount-"))
    const handle = await mountDshIfEnabled({ home, logFile: join(home, "dsh-plugins.log") })
    expect(handle).toBeDefined()
    await handle!.dispose()
    expect((globalThis as Record<string, unknown>)[CONTAINER_KEY]).toBeUndefined()
  }, 60_000)
})
