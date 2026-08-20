/**
 * Experiment 1: container scope instantiation (research §17.4, guesses S7–S10).
 *
 * Verifies the dsh three-layer plugin instantiation model works for the
 * "per-directory scope" mapping ellamaka needs:
 *
 *  - S7: createScope(directoryKey) in a non-agent scenario mounts plugins
 *  - S8: scope.dispose() cleanly removes the scope layer
 *  - S9: the same plugin code under two scopes yields isolated instances
 *  - S10 (shadow): a scope registration shadows the global name
 *
 * Mechanism note (probed): a scope context cannot access `ctx.tools` directly
 * (cordis requires an inject declaration), but a plugin mounted on the scope
 * context CAN — that is the canonical dsh registration path. Tools are
 * therefore registered through a per-scope plugin function.
 *
 * dsh packages are resolved through the `@deepseek-ai/dsh` install anchor —
 * the same pattern serve.ts uses for installAnchor — because the packages
 * live in the dsh closure, not in this package's own dependencies.
 */
import { describe, expect, test } from "bun:test"
import { createRequire } from "node:module"
import { Context } from "@deepseek-ai/cordis"

const req = createRequire(import.meta.url)
const dshAnchorDir = req.resolve("@deepseek-ai/dsh/package.json").replace("/package.json", "")
const dshReq = createRequire(`${dshAnchorDir}/package.json`)

const { createScope } = await import(dshReq.resolve("@deepseek-ai/dsh-scope"))
const { default: SystemPrompt } = await import(dshReq.resolve("@deepseek-ai/dsh-system-prompt"))
const { default: ToolRuntime, defineTool } = await import(dshReq.resolve("@deepseek-ai/dsh-tools"))
import type { ScopeKey } from "@deepseek-ai/dsh-scope"

type ToolSchema = { name: string }

/** A fresh container with systemPrompt + tools services mounted at root. */
async function bootContainer() {
  const ctx = new Context()
  await Promise.resolve(ctx.plugin(SystemPrompt as never))
  await Promise.resolve(ctx.plugin(ToolRuntime as never, {}))
  return ctx
}

/**
 * Mount one counter tool on a context through a plugin function — the dsh
 * canonical path. Every invocation creates an ISOLATED counter instance, so
 * mounting the same factory on two scopes yields two independent instances.
 */
function mountCounterTool(ctx: Context, toolName: string) {
  const calls: string[] = []
  const plugin = {
    name: `counter-${toolName}`,
    inject: ["tools"],
    apply(pluginCtx: { tools: { register(def: unknown): () => void } }) {
      const tool = defineTool({
        name: toolName,
        description: `scoped counter tool ${toolName}`,
        parameters: {},
        output: {
          schema: { type: "string" as const },
          render: (_args: unknown, value: unknown) => [{ type: "text" as const, text: String(value) }],
        },
        execute: async () => {
          calls.push(`call-${calls.length}`)
          return `${toolName} calls=${calls.length}`
        },
      })
      return pluginCtx.tools.register(tool)
    },
  }
  const mount = Promise.resolve(ctx.plugin(plugin as never))
  return { calls, mounted: mount }
}

function execFor(name: string, agent?: object, signal?: AbortSignal) {
  return {
    callId: `call-${name}`,
    rootCallId: `call-${name}`,
    name,
    arguments: {},
    signal: signal ?? new AbortController().signal,
    ...(agent ? { agent } : {}),
  }
}

/** dsh ToolRuntime.execute takes ONE exec object (name/arguments inside). */
function run(ctx: Context, name: string, agent?: object) {
  return (ctx.tools as { execute(exec: unknown): Promise<{ isError: boolean }> }).execute(execFor(name, agent))
}

const names = (schemas: ToolSchema[]) => schemas.map((s) => s.name).sort()

describe("experiment 1: per-directory scope instantiation", () => {
  test("S7: createScope mounts a plugin whose tool is visible only to that scope", async () => {
    const ctx = await bootContainer()
    await mountCounterTool(ctx, "global_probe").mounted

    const dirA: ScopeKey = { directory: "/workspace/a" }
    const scopeA = createScope(ctx, dirA)
    await mountCounterTool(scopeA.ctx, "dir_a_tool").mounted

    // global view: only the global tool
    expect(names(ctx.tools.schemas() as ToolSchema[])).toEqual(["global_probe"])
    // scope A view: global + own
    expect(names(ctx.tools.schemas(dirA) as ToolSchema[])).toEqual(["dir_a_tool", "global_probe"])
    // an unrelated sibling scope sees nothing of A
    const dirB: ScopeKey = { directory: "/workspace/b" }
    expect(names(ctx.tools.schemas(dirB) as ToolSchema[])).toEqual(["global_probe"])
  })

  test("S9: same plugin code under two scopes yields isolated instances", async () => {
    const ctx = await bootContainer()
    const dirA: ScopeKey = { directory: "/workspace/a" }
    const dirB: ScopeKey = { directory: "/workspace/b" }
    const scopeA = createScope(ctx, dirA)
    const scopeB = createScope(ctx, dirB)

    const instA = mountCounterTool(scopeA.ctx, "shared_name")
    const instB = mountCounterTool(scopeB.ctx, "shared_name")
    await instA.mounted
    await instB.mounted

    // execute twice under scope A's key (plain object as the routing key)
    await run(ctx, "shared_name", dirA)
    await run(ctx, "shared_name", dirA)
    // once under scope B's key
    await run(ctx, "shared_name", dirB)

    expect(instA.calls.length).toBe(2)
    expect(instB.calls.length).toBe(1)
  })

  test("S10: scope registration shadows the global name for that scope only", async () => {
    const ctx = await bootContainer()
    const globalTool = mountCounterTool(ctx, "shadowed")
    await globalTool.mounted

    const dirA: ScopeKey = { directory: "/workspace/a" }
    const scopeA = createScope(ctx, dirA)
    const overrideA = mountCounterTool(scopeA.ctx, "shadowed")
    await overrideA.mounted

    await run(ctx, "shadowed", dirA)
    await run(ctx, "shadowed")

    expect(overrideA.calls.length).toBe(1)
    expect(globalTool.calls.length).toBe(1)
  })

  test("S8: scope.dispose() removes the scope layer and its tools", async () => {
    const ctx = await bootContainer()
    const dirA: ScopeKey = { directory: "/workspace/a" }
    const scopeA = createScope(ctx, dirA)
    const toolA = mountCounterTool(scopeA.ctx, "dir_a_tool")
    await toolA.mounted
    expect(names(ctx.tools.schemas(dirA) as ToolSchema[])).toContain("dir_a_tool")

    await scopeA.dispose()

    expect(names(ctx.tools.schemas(dirA) as ToolSchema[])).not.toContain("dir_a_tool")
    // the tool is no longer executable under that key
    const result = await run(ctx, "dir_a_tool", dirA)
    expect(result.isError).toBe(true)
  })

  test("execution routes by the exec key: a tool invisible to one scope reads as UNKNOWN_TOOL", async () => {
    const ctx = await bootContainer()
    const dirA: ScopeKey = { directory: "/workspace/a" }
    const dirB: ScopeKey = { directory: "/workspace/b" }
    const scopeA = createScope(ctx, dirA)
    const toolA = mountCounterTool(scopeA.ctx, "dir_a_only")
    await toolA.mounted

    const underA = await run(ctx, "dir_a_only", dirA)
    expect(underA.isError).toBe(false)

    const underB = await run(ctx, "dir_a_only", dirB)
    expect(underB.isError).toBe(true)
  })
})
