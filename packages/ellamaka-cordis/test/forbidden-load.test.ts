import { describe, expect, test } from "bun:test"
import { Module } from "node:module"
import { CordisHub } from "../src/hub"
import { Tools } from "../src/tools/registry"

/**
 * Red line §9.2 runtime gate (CORDIS DESIGN §9).
 *
 * The six deeply-coupled dsh packages (agent-loop/session/session-query/
 * compaction/subagent/schedule) must never be loaded at runtime. The gate
 * verifies the stronger, real invariant: zero runtime module resolutions
 * while loading the bridge public API and exercising the tools pipeline.
 */
const FORBIDDEN = [
  "dsh-agent-loop",
  "dsh-session",
  "dsh-session-query",
  "dsh-compaction",
  "dsh-subagent",
  "dsh-schedule",
] as const

describe("red line §9.2 runtime gate", () => {
  test("loading the bridge public API and exercising tools resolves zero forbidden packages", async () => {
    const resolved: string[] = []
    const mod = Module as unknown as {
      _resolveFilename: (request: string, ...rest: unknown[]) => string
    }
    const orig = mod._resolveFilename
    mod._resolveFilename = function (request: string, ...rest: unknown[]) {
      resolved.push(request)
      return orig.call(this, request, ...rest)
    }

    try {
      // The public surface the opencode mainline loads from this package.
      await import("../src/index")

      const hub = new CordisHub(null)
      await hub.mount(Tools)
      // Dispatch a plain-text result so the tools pipeline runs.
      hub.ctx.tools.register({
        name: "big",
        description: "emits plain text",
        parameters: {},
        execute: async () => "x".repeat(4096),
      })
      await hub.ctx.tools.execute(
        "big",
        undefined,
        {
          callId: "c1",
          rootCallId: "c1",
          name: "big",
          arguments: undefined,
          agent: { session: { header: { id: "probe", cwd: "/probe" } } },
          signal: new AbortController().signal,
        },
      )
      await hub.dispose()
    } finally {
      mod._resolveFilename = orig
    }

    const hits = resolved.filter((request) =>
      FORBIDDEN.some((name) => request.includes(name)),
    )
    expect(hits).toEqual([])
  })
})
