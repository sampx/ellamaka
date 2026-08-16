import { describe, expect, test } from "bun:test"
import { CordisHub } from "../src/hub"
import { Tools } from "../src/tools/registry"
import type { ToolDefinition, ToolExecution, ContentBlock } from "../src/tools/types"

/** Minimal registered tool used across the registry cases. */
const echoDef: ToolDefinition = {
  name: "echo",
  description: "echoes its arguments",
  parameters: {},
  execute: async (args: unknown) => args,
}

/** A throwing tool used to exercise the error path into the waterfall. */
const boomDef: ToolDefinition = {
  name: "boom",
  description: "always throws",
  parameters: {},
  execute: async () => {
    throw new Error("boom exploded")
  },
}

/** Build an execution object for a named call. */
function exec(name: string): ToolExecution {
  return {
    callId: "call-1",
    rootCallId: "call-1",
    name,
    arguments: undefined,
    signal: new AbortController().signal,
  }
}

/** Mount the Tools service on a fresh hub and return it. */
async function mountTools() {
  const hub = new CordisHub(null)
  await hub.mount(Tools)
  return { hub, tools: hub.ctx.tools }
}

// --- 1. Registration / query ---

describe("tools.register / tools.get", () => {
  test("get returns the registered definition for a known name", async () => {
    const { hub, tools } = await mountTools()
    tools.register(echoDef)
    expect(tools.get("echo")).toBe(echoDef)
    await hub.dispose()
  })

  test("get returns undefined for an unregistered name", async () => {
    const { hub, tools } = await mountTools()
    expect(tools.get("echo")).toBeUndefined()
    await hub.dispose()
  })
})

// --- 2. Execution materialization ---

describe("tools.execute materialization", () => {
  test("a successful execution materializes { isError: false, content }", async () => {
    const { hub, tools } = await mountTools()
    tools.register(echoDef)
    const result = await tools.execute("echo", { hi: 1 }, exec("echo"))
    expect(result.isError).toBe(false)
    expect(Array.isArray(result.content)).toBe(true)
    expect((result.content[0] as ContentBlock & { text?: string }).text).toContain("hi")
    await hub.dispose()
  })

  test("an unregistered tool yields a UNKNOWN_TOOL error result", async () => {
    const { hub, tools } = await mountTools()
    const result = await tools.execute("nope", undefined, exec("nope"))
    expect(result.isError).toBe(true)
    expect(result.error.message).toMatch(/unknown tool "nope"/)
    await hub.dispose()
  })
})

// --- 3. post-execute waterfall ---

describe("tools post-execute waterfall", () => {
  test("no listener accepts the result unchanged", async () => {
    const { hub, tools } = await mountTools()
    tools.register(echoDef)
    const result = await tools.execute("echo", { hi: 1 }, exec("echo"))
    expect(result.isError).toBe(false)
    expect((result.content[0] as ContentBlock & { text?: string }).text).toContain("hi")
    await hub.dispose()
  })

  test("a listener replacing content overrides the result content", async () => {
    const { hub, tools } = await mountTools()
    tools.register(echoDef)
    hub.ctx.on("tools/post-execute", async (execArg, result, next) => {
      await next()
      return { kind: "accept", content: [{ type: "text", text: "replaced" }] }
    })
    const result = await tools.execute("echo", { hi: 1 }, exec("echo"))
    expect(result.isError).toBe(false)
    expect((result.content[0] as ContentBlock & { text?: string }).text).toBe("replaced")
    await hub.dispose()
  })

  test("a listener returning block turns the result into error feedback", async () => {
    const { hub, tools } = await mountTools()
    tools.register(echoDef)
    hub.ctx.on("tools/post-execute", async (_exec, _result, next) => {
      await next()
      return { kind: "block", feedback: [{ type: "text", text: "denied by policy" }] }
    })
    const result = await tools.execute("echo", { hi: 1 }, exec("echo"))
    expect(result.isError).toBe(true)
    expect(result.error.message).toMatch(/denied by policy/)
    await hub.dispose()
  })
})

// --- 4. Thrown errors still enter the waterfall ---

describe("tools.execute error into waterfall", () => {
  test("a thrown execution error still reaches post-execute listeners", async () => {
    const { hub, tools } = await mountTools()
    tools.register(boomDef)
    let seenError: boolean | undefined
    hub.ctx.on("tools/post-execute", async (execArg, result, next) => {
      seenError = result.isError
      await next()
      return { kind: "accept", content: [{ type: "text", text: "contained" }] }
    })
    const result = await tools.execute("boom", undefined, exec("boom"))
    // The listener observed the error result inside the waterfall.
    expect(seenError).toBe(true)
    // And the waterfall replacement still applies to the error result.
    expect(result.isError).toBe(true)
    expect((result.content[0] as ContentBlock & { text?: string }).text).toBe("contained")
    await hub.dispose()
  })
})
