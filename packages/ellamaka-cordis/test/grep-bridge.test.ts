import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { CordisHub } from "../src/hub"
import { Tools } from "../src/tools/registry"
import { createGrepBridge } from "../src/tools/grep-bridge"
import type { ContentBlock, ToolExecution } from "../src/tools/types"

/** Build an execution object for a named call with a caller-owned signal. */
function exec(name: string, signal: AbortSignal): ToolExecution {
  return {
    callId: "call-1",
    rootCallId: "call-1",
    name,
    arguments: undefined,
    signal,
  }
}

/**
 * Mount the Tools service and a grep bridge backed by `nativeExecute` on a
 * fresh hub. Returns the hub, the tools registry, and the caller controller.
 */
async function setup(nativeExecute: (args: unknown) => Effect.Effect<unknown>) {
  const runtime = ManagedRuntime.make(Layer.empty)
  const hub = new CordisHub(runtime)
  await hub.mount(Tools)
  hub.ctx.tools.register(createGrepBridge(nativeExecute, runtime))
  return { hub, tools: hub.ctx.tools }
}

function textOf(result: { content: ContentBlock[] }): string {
  const block = result.content[0] as ContentBlock & { text?: string }
  return block.text ?? ""
}

// --- 1. Success ---

describe("createGrepBridge success", () => {
  test("a native Effect success materializes { isError: false, content }", async () => {
    const { hub, tools } = await setup(() => Effect.succeed("match on line 3"))
    const controller = new AbortController()
    const result = await tools.execute("grep", { pattern: "match" }, exec("grep", controller.signal))
    expect(result.isError).toBe(false)
    expect(textOf(result)).toBe("match on line 3")
    await hub.dispose()
  })
})

// --- 2. Abort interrupts the native fiber ---

describe("createGrepBridge abort", () => {
  test("aborting exec.signal interrupts the native fiber and yields an error result", async () => {
    let finalizerRan = false
    // A never-completing effect that runs a finalizer on interrupt.
    const nativeExecute = () =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            finalizerRan = true
          }))
        yield* Effect.never
      })
    const { hub, tools } = await setup(nativeExecute)
    const controller = new AbortController()

    const pending = tools.execute("grep", { pattern: "match" }, exec("grep", controller.signal))
    // Abort after the forked fiber has been registered; the bridge forwards the
    // signal to interrupt the work fiber deterministically.
    await new Promise((r) => setTimeout(r, 10))
    controller.abort()

    const result = await pending
    expect(result.isError).toBe(true)
    expect(finalizerRan).toBe(true)
    await hub.dispose()
  })
})

// --- 3. Native failure becomes an error result that still enters the waterfall ---

describe("createGrepBridge failure", () => {
  test("a native Effect failure yields an error result that reaches post-execute", async () => {
    const { hub, tools } = await setup(() => Effect.fail(new Error("grep exploded")))
    let seenError: boolean | undefined
    hub.ctx.on("tools/post-execute", async (execArg, result, next) => {
      seenError = result.isError
      await next()
      return { kind: "accept", content: [{ type: "text", text: "contained" }] }
    })
    const controller = new AbortController()
    const result = await tools.execute("grep", { pattern: "match" }, exec("grep", controller.signal))
    expect(seenError).toBe(true)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe("contained")
    await hub.dispose()
  })
})
