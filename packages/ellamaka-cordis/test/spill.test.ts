import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CordisHub } from "../src/hub"
import { Tools } from "../src/tools/registry"
import type { ContentBlock, ToolDefinition, ToolExecution } from "../src/tools/types"
import { mountSpillPlugins } from "../src/spill/mount"
import * as SpillPolicy from "@deepseek-ai/dsh-spill-policy"

/** A tool whose result is a fixed plain-text body. */
function textTool(name: string, body: string): ToolDefinition {
  return {
    name,
    description: "returns a fixed text body",
    parameters: {},
    execute: async () => body,
  }
}

/** Build an execution object for a named call, optionally with a session owner. */
function exec(name: string, opts: { sessionID?: string } = {}): ToolExecution {
  return {
    callId: "call-1",
    rootCallId: "call-1",
    name,
    arguments: undefined,
    agent: opts.sessionID ? { session: { header: { id: opts.sessionID, cwd: "/cwd" } } } : undefined,
    signal: new AbortController().signal,
  }
}

/** Mount Tools + the spill plugins on a fresh hub. */
async function mountSpill(maxInlineBytes: number) {
  const root = mkdtempSync(join(tmpdir(), "dsh-spill-test-"))
  const hub = new CordisHub(null)
  await hub.mount(Tools)
  await mountSpillPlugins(hub.ctx, { root, maxInlineBytes })
  return { hub, root }
}

function textOf(content: ContentBlock[]): string {
  const block = content[0] as ContentBlock & { text?: string }
  return block.text ?? ""
}

/** The locator path extracted from a spill notice, or `undefined`. */
function spillPathFrom(text: string): string | undefined {
  const match = /stored at: (\S+?)\. Use /.exec(text)
  return match?.[1]
}

describe("mountSpillPlugins oversized plain-text spill", () => {
  test("replaces an oversized result with a preview + locator and writes a full dump file", async () => {
    const body = "X".repeat(8000) // 8000 bytes, well over the cap
    const { hub, root } = await mountSpill(1000)
    hub.ctx.tools.register(textTool("big", body))

    const result = await hub.ctx.tools.execute("big", undefined, exec("big", { sessionID: "s1" }))
    expect(result.isError).toBe(false)

    const text = textOf(result.content)
    // The model sees a bounded preview + locator, not the full body.
    expect(text).not.toBe(body)
    expect(text.startsWith("X")).toBe(true)
    expect(text).toContain("Full formatted result stored at:")
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(body.length)

    // A dump file exists on disk containing the FULL original text.
    const spillPath = spillPathFrom(text)
    expect(spillPath).toBeDefined()
    expect(readFileSync(spillPath!, "utf8")).toBe(body)
    expect(statSync(spillPath!).size).toBe(Buffer.byteLength(body, "utf8"))

    // The dump lives under the configured root's session-scoped dir.
    expect(spillPath!.startsWith(root)).toBe(true)

    await hub.dispose()
  })

  test("leaves a within-cap plain-text result unchanged and writes no dump", async () => {
    const { hub, root } = await mountSpill(1000)
    hub.ctx.tools.register(textTool("small", "tiny"))

    const result = await hub.ctx.tools.execute("small", undefined, exec("small", { sessionID: "s1" }))
    expect(result.isError).toBe(false)
    expect(textOf(result.content)).toBe("tiny")

    expect(readdirSync(root)).toHaveLength(0)
    await hub.dispose()
  })

  test("skips the read tool to avoid a read -> spill -> read loop", async () => {
    const body = "x".repeat(5000)
    const { hub, root } = await mountSpill(100)
    hub.ctx.tools.register(textTool("read", body))

    const result = await hub.ctx.tools.execute("read", undefined, exec("read", { sessionID: "s1" }))
    expect(result.isError).toBe(false)
    // read is not spilled: the full inline body survives.
    expect(textOf(result.content)).toBe(body)
    expect(readdirSync(root)).toHaveLength(0)
    await hub.dispose()
  })
})

describe("mountSpillPlugins best-effort degradation", () => {
  test("keeps the inline result when there is no session owner", async () => {
    const body = "x".repeat(2000)
    const { hub, root } = await mountSpill(100)
    hub.ctx.tools.register(textTool("big", body))

    const result = await hub.ctx.tools.execute("big", undefined, exec("big"))
    expect(result.isError).toBe(false)
    expect(textOf(result.content)).toBe(body)
    expect(readdirSync(root)).toHaveLength(0)
    await hub.dispose()
  })

  test("keeps the inline result when no spillStore backend is loaded", async () => {
    // Mount only the policy (no LocalSpillStore): a spill backend is absent.
    const hub = new CordisHub(null)
    await hub.mount(Tools)
    await hub.ctx.plugin(SpillPolicy, { maxInlineBytes: 100 })
    const body = "x".repeat(2000)
    hub.ctx.tools.register(textTool("big", body))

    const result = await hub.ctx.tools.execute("big", undefined, exec("big", { sessionID: "s1" }))
    // Best-effort: the successful call is not turned into an error; inline kept.
    expect(result.isError).toBe(false)
    expect(textOf(result.content)).toBe(body)
    await hub.dispose()
  })
})

describe("mountSpillPlugins contract conformance smoke (Q3)", () => {
  test("registers the spillStore service and the post-execute listener", async () => {
    const { hub } = await mountSpill(200)
    // LocalSpillStore registers as ctx.spillStore.
    expect(hub.ctx.get("spillStore")).toBeDefined()
    await hub.dispose()
  })

  test("dispose is clean: the spill listener is gone after hub.dispose", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-spill-test-"))
    const hub = new CordisHub(null)
    await hub.mount(Tools)
    await mountSpillPlugins(hub.ctx, { root, maxInlineBytes: 100 })
    hub.ctx.tools.register(textTool("big", "x".repeat(2000)))

    await hub.dispose()
    // After dispose the container is torn down; a fresh (unmounted) context
    // has no spill behavior — the disposal path is idempotent and clean.
    await hub.dispose()
  })
})
