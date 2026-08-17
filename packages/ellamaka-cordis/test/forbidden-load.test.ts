import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Module } from "node:module"
import { CordisHub } from "../src/hub"
import { Tools } from "../src/tools/registry"
import { mountSpillPlugins } from "../src/spill/mount"

/**
 * Red line §9.2 runtime gate (CORDIS DESIGN §9).
 *
 * The six deeply-coupled dsh packages (agent-loop/session/session-query/
 * compaction/subagent/schedule) must never be loaded at runtime. Type-only
 * presence via required peers (e.g. spill's `import type { SessionId }`) is
 * allowed — the gate verifies the stronger, real invariant: zero runtime
 * module resolutions while mounting and exercising the spill trio.
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
  test("loading and mounting the spill trio resolves zero forbidden packages", async () => {
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
      await import("@deepseek-ai/dsh-spill")
      await import("@deepseek-ai/dsh-spill-local")
      await import("@deepseek-ai/dsh-spill-policy")

      const root = mkdtempSync(join(tmpdir(), "cordis-probe-"))
      const hub = new CordisHub(null)
      await hub.mount(Tools)
      await mountSpillPlugins(hub.ctx, { root, maxInlineBytes: 1024 })
      // Dispatch an oversized text result so the policy's spill path runs.
      hub.ctx.tools.register({
        name: "big",
        description: "emits oversized text",
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
          agent: { session: { header: { id: "probe", cwd: root } } },
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
