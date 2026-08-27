import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { Context } from "@deepseek-ai/cordis"
import { bootDshWeb, mountDshWeb, mountDshTools } from "../src/dsh-web"

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

/**
 * The tool-container profile: a dedicated dsh profile for ellamaka's direct
 * tool adoption. It initializes a user-editable profile entry whose patch
 * layer disables the agent-loop-only plugins, so tools execute with a
 * lightweight per-call context without live dsh sessions.
 */
describe("dsh tools profile", () => {
  test("mountDshTools mounts the tool profile on a context and disposes cleanly", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-tools-host-"))
    const ctx = new Context()
    const host = await mountDshTools(ctx, { home, port: 0 })

    try {
      const tools = ctx.get("tools") as { schemas(): { name: string }[] }
      const names = tools.schemas().map((t) => t.name)
      expect(names).toContain("grep")
      expect(names).toContain("glob")
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
    }
  }, 30_000)

  test("mountDshTools disables session-checkpoint-policy via the profile patch layer", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-tools-host-"))
    const ctx = new Context()
    const host = await mountDshTools(ctx, { home, port: 0 })

    try {
      const ws = mkdtempSync(join(tmpdir(), "dsh-tools-ws-"))
      for (let i = 0; i < 400; i++) {
        writeFileSync(join(ws, `f${i}.txt`), `needle line ${i}\n`)
      }

      const tools = ctx.get("tools") as {
        execute(exec: unknown): Promise<{ isError: boolean; content?: { type: string; text?: string }[] }>
      }
      const facade = { session: { header: { id: `tools-${Date.now()}`, cwd: ws } } }
      const result = await tools.execute({
        callId: "tools-profile-call",
        name: "grep",
        arguments: { pattern: "needle", path: ws },
        signal: new AbortController().signal,
        agent: facade,
      })
      const text = (result.content ?? []).map((b) => b.text ?? "").join("\n")
      expect(result.isError).toBe(false)
      expect(text).toContain("250 of 400")

      // No live session was created.
      const sessions = ctx.get("sessions") as { list(): unknown[] } | undefined
      expect(sessions?.list() ?? []).toEqual([])
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
    }
  }, 60_000)

  test("mountDshTools runs read, write, and edit through the sandboxed filesystem", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-tools-host-"))
    const workspace = mkdtempSync(join(tmpdir(), "dsh-tools-ws-"))
    const ctx = new Context()
    const host = await mountDshTools(ctx, { home, port: 0 })

    try {
      const tools = ctx.get("tools") as {
        schemas(): { name: string }[]
        execute(exec: unknown): Promise<{
          isError: boolean
          error?: { info?: { code?: string } }
        }>
      }
      const session = { header: { id: "tools-fs-session", cwd: workspace }, events: [] }
      const execute = (name: string, arguments_: Record<string, unknown>) =>
        tools.execute({
          callId: `tools-fs-${name}`,
          name,
          arguments: arguments_,
          signal: new AbortController().signal,
          agent: { session },
        })

      expect((ctx.get("fs") as { sandboxMode?: string }).sandboxMode).toBe("workspace-write")
      expect(tools.schemas().map((tool) => tool.name)).toEqual(expect.arrayContaining(["read", "write", "edit"]))

      expect((await execute("write", { file_path: "created.txt", content: "created" })).isError).toBe(false)
      expect((await execute("read", { file_path: "created.txt" })).isError).toBe(false)

      writeFileSync(join(workspace, "edit.txt"), "before")
      const unreadEdit = await execute("edit", { file_path: "edit.txt", old_string: "before", new_string: "after" })
      expect(unreadEdit.isError).toBe(true)
      expect(unreadEdit.error?.info?.code).toBe("FS_NOT_OBSERVED")

      expect((await execute("read", { file_path: "edit.txt" })).isError).toBe(false)
      expect((await execute("edit", { file_path: "edit.txt", old_string: "before", new_string: "after" })).isError).toBe(false)
      expect(readFileSync(join(workspace, "edit.txt"), "utf-8")).toBe("after")

      const denied = await execute("write", {
        file_path: join(homedir(), `.dsh-tools-denied-${Date.now()}.txt`),
        content: "denied",
      })
      expect(denied.isError).toBe(true)
      expect(denied.error?.info?.code).toBe("FS_SANDBOX_DENIED")
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
    }
  }, 60_000)

  test("mountDshTools runs str_replace_editor through the sandboxed filesystem", async () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-tools-host-"))
    const workspace = mkdtempSync(join(tmpdir(), "dsh-tools-editor-ws-"))
    const ctx = new Context()
    const host = await mountDshTools(ctx, { home, port: 0 })

    try {
      const tools = ctx.get("tools") as {
        schemas(): { name: string }[]
        execute(exec: unknown): Promise<{
          isError: boolean
          content?: { type: string; text?: string }[]
          error?: { info?: { code?: string } }
        }>
      }
      const session = { header: { id: "tools-editor-session", cwd: workspace }, events: [] }
      let call = 0
      const execute = (arguments_: Record<string, unknown>) =>
        tools.execute({
          callId: `tools-editor-${++call}`,
          name: "str_replace_editor",
          arguments: arguments_,
          signal: new AbortController().signal,
          agent: { session },
        })
      const editorPath = join(workspace, "editor.txt")

      expect(tools.schemas().map((tool) => tool.name)).toContain("str_replace_editor")
      expect((await execute({ command: "create", path: editorPath, file_text: "one\ntwo" })).isError).toBe(false)
      expect((await execute({ command: "view", path: editorPath })).isError).toBe(false)
      expect((await execute({ command: "str_replace", path: editorPath, old_str: "two", new_str: "TWO" })).isError).toBe(false)
      expect((await execute({ command: "insert", path: editorPath, insert_line: 1, new_str: "between" })).isError).toBe(false)
      expect(readFileSync(editorPath, "utf-8")).toBe("one\nbetween\nTWO")

      writeFileSync(join(workspace, "unseen.txt"), "before")
      const unseen = await execute({ command: "str_replace", path: join(workspace, "unseen.txt"), old_str: "before", new_str: "after" })
      expect(unseen.isError).toBe(true)
      expect(unseen.error?.info?.code).toBe("FS_NOT_OBSERVED")
      expect((await execute({ command: "view", path: "relative.txt" })).isError).toBe(true)

      const denied = await execute({
        command: "create",
        path: join(homedir(), `.dsh-tools-editor-denied-${Date.now()}.txt`),
        file_text: "denied",
      })
      expect(denied.isError).toBe(true)
      expect(denied.error?.info?.code).toBe("FS_SANDBOX_DENIED")
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
    }
  }, 60_000)

  // Parameterized across sandbox modes: `workspace-write` confines the
  // container's bash to the workspace (external writes denied), while
  // `danger-full-access` (the adapter's "sandbox off" mapping, DESIGN §4.10)
  // lets the same tool write outside the workspace. Both run in the real
  // tool container — only the facade `sandbox/mode` event differs.
  test.each([
    { name: "workspace-write", mode: "workspace-write", outside: "denied" },
    { name: "danger-full-access", mode: "danger-full-access", outside: "allowed" },
  ])("mountDshTools runs foreground bash under $name sandbox mode", async ({ mode, outside }) => {
    const home = mkdtempSync(join(tmpdir(), "dsh-tools-host-"))
    const workspace = mkdtempSync(join(tmpdir(), "dsh-tools-bash-ws-"))
    const ctx = new Context()
    const host = await mountDshTools(ctx, { home, port: 0 })

    try {
      const tools = ctx.get("tools") as {
        schemas(): { name: string; parameters: { properties: Record<string, unknown> } }[]
        execute(exec: unknown): Promise<{
          isError: boolean
          content?: { type: string; text?: string }[]
        }>
      }
      const session = { header: { id: "tools-bash-session", cwd: workspace }, events: [{ type: "sandbox/mode", data: { mode } }] }
      let call = 0
      const execute = (arguments_: Record<string, unknown>) =>
        tools.execute({
          callId: `tools-bash-${++call}`,
          name: "bash",
          arguments: arguments_,
          signal: new AbortController().signal,
          agent: { session },
        })
      const allowed = join(workspace, "allowed.txt")
      const bash = tools.schemas().find((tool) => tool.name === "bash")

      expect(tools.schemas().map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["read", "write", "edit", "grep", "glob", "bash", "str_replace_editor"]),
      )
      expect((ctx.get("shell") as { sandboxMode?: string }).sandboxMode).toBe("workspace-write")
      expect(ctx.get("shellEnv")).toBeDefined()
      expect(bash).toBeDefined()
      expect(bash?.parameters.properties).not.toHaveProperty("run_in_background")
      const pwd = await execute({ command: "pwd", description: "Print sandbox workspace directory" })
      expect((pwd.content ?? []).map((block) => block.text ?? "").join("\n")).toContain(workspace)
      expect((await execute({ command: `printf bash-ok > "${allowed}"`, description: "Write sandbox proof file" })).isError).toBe(false)
      expect(readFileSync(allowed, "utf-8")).toBe("bash-ok")

      // homedir is used (not /tmp) because dsh's `workspace-write` sandbox
      // allows host /tmp but denies homedir — so the external write probe is
      // only denied under `workspace-write` and only allowed under
      // `danger-full-access`.
      const outsidePath = join(homedir(), `.dsh-tools-bash-${mode}-${Date.now()}.txt`)
      const result = await execute({ command: `printf outside > "${outsidePath}"`, description: "Write outside the workspace" })
      if (outside === "denied") {
        expect(result.isError).toBe(false)
        expect((result.content ?? []).map((block) => block.text ?? "").join("\n")).toContain(
          "[sandbox: file access denied under workspace-write mode]",
        )
      } else {
        expect(result.isError).toBe(false)
        expect(readFileSync(outsidePath, "utf-8")).toBe("outside")
      }
    } finally {
      await host.dispose()
      await ctx.fiber.dispose()
    }
  }, 60_000)
})
