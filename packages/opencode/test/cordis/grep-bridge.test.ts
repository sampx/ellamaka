import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ToolRegistry } from "@/tool/registry"
import { GrepBridgeService } from "@/tool/registry"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Plugin } from "@/plugin"
import { Question } from "@/question"
import { Todo } from "@/session/todo"
import { Skill } from "@/skill"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Provider } from "@/provider/provider"
import { Git } from "@/git"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "@/session/instruction"
import { Bus } from "@/bus"
import { FetchHttpClient } from "effect/unstable/http"
import { Format } from "@/format"
import { Ripgrep } from "@/file/ripgrep"
import * as Truncate from "@/tool/truncate"
import { InstanceState } from "@/effect/instance-state"
import { Reference } from "@/reference/reference"
import { RepositoryCache } from "@/reference/repository-cache"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Tool } from "@/tool/tool"
import { ProviderID, ModelID } from "@/provider/schema"
import {
  cordisHubLayer,
  createGrepBridgeLayer,
  CordisHubService,
  Tools,
  createGrepBridge,
  type ToolExecutionResult,
  type ToolExecution,
} from "@wopal/ellamaka-cordis"
import { SessionID, MessageID } from "@/session/schema"

const node = CrossSpawnSpawner.defaultLayer
const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

// The ToolRegistry layer with all of its real dependencies (mirrors
// test/tool/registry.test.ts). No grep-bridge service is provided by default,
// so the registry behaves exactly as before (zero regression).
const registryLayer = () =>
  ToolRegistry.layer
    .pipe(
      Layer.provide(configLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(Question.defaultLayer),
      Layer.provide(Todo.defaultLayer),
      Layer.provide(Skill.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(Layer.mergeAll(SessionStatus.defaultLayer, BackgroundJob.defaultLayer)),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(Layer.mergeAll(Git.defaultLayer, RepositoryCache.defaultLayer)),
      Layer.provide(Reference.defaultLayer),
      Layer.provide(LSP.defaultLayer),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(AppFileSystem.defaultLayer),
      Layer.provide(Bus.layer),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Format.defaultLayer),
      Layer.provide(node),
      Layer.provide(Ripgrep.defaultLayer),
      Layer.provide(Truncate.defaultLayer),
    )
    .pipe(Layer.provide(RuntimeFlags.layer({})))

// The registry plus the cordis grep-bridge assembly: the hub is provisioned
// per-scope, and the bridge layer provides GrepBridgeService so the registry's
// optional injection point picks it up and routes grep through ctx.tools.
const bridgedRegistryLayer = Layer.mergeAll(
  registryLayer(),
  cordisHubLayer,
  createGrepBridgeLayer(GrepBridgeService).pipe(Layer.provide(cordisHubLayer)),
)

const it = testEffect(Layer.mergeAll(registryLayer(), node, Agent.defaultLayer))
const bridgedIt = testEffect(Layer.mergeAll(bridgedRegistryLayer, node, Agent.defaultLayer))

/** Minimal tool context used to drive a registry grep def directly. */
function toolCtx(abort = new AbortController().signal): Tool.Context {
  return {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    agent: "build",
    abort,
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

/** Pull the `grep` def out of the registry for direct execution. */
function grepDef(registry: ToolRegistry.Interface) {
  return Effect.gen(function* () {
    const agent = yield* Agent.Service
    const list = yield* registry.tools({
      providerID: ProviderID.opencode,
      modelID: ModelID.make("test"),
      agent: yield* agent.defaultInfo(),
    })
    const def = list.find((t) => t.id === "grep")
    if (!def) throw new Error("grep tool not registered")
    return def
  })
}

describe("grep-bridge: zero regression without cordis assembly", () => {
  it.instance("grep executes natively with unchanged behavior", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Bun.write(path.join(test.directory, "file.txt"), "alpha\nbeta\ngamma"),
      )
      const registry = yield* ToolRegistry.Service
      const def = yield* grepDef(registry)
      const result = yield* def.execute(
        { pattern: "beta", path: test.directory },
        toolCtx(),
      )
      expect(result.output).toContain("Found 1 match")
      expect(result.output).toContain("beta")
    }),
  )
})

describe("grep-bridge: real grep through ctx.tools full chain", () => {
  bridgedIt.instance("routes grep through the waterfall and reaches the model", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Bun.write(path.join(test.directory, "file.txt"), "alpha\nneedle\nomega"),
      )

      // Observe the post-execute waterfall on the instance hub's ctx.tools.
      const registry = yield* CordisHubService
      const hub = yield* registry.forDirectory(test.directory).pipe(Effect.scoped)
      let seenInWaterfall: ToolExecutionResult | undefined
      hub.ctx.on("tools/post-execute", async (_exec, result, next) => {
        seenInWaterfall = result
        await next()
        return { kind: "accept" }
      })

      const registrySvc = yield* ToolRegistry.Service
      const def = yield* grepDef(registrySvc)
      const result = yield* def.execute({ pattern: "needle", path: test.directory }, toolCtx())

      // The native grep output reached the model unchanged.
      expect(result.output).toContain("needle")

      // And the dispatch passed through the ctx.tools waterfall.
      expect(seenInWaterfall).toBeDefined()
      expect(seenInWaterfall!.isError).toBe(false)
      expect(seenInWaterfall!.content[0]).toBeDefined()
    }),
  )

  bridgedIt.instance("session facade header is populated for spill-policy", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "file.txt"), "needle\n"))

      const registry = yield* CordisHubService
      const hub = yield* registry.forDirectory(test.directory).pipe(Effect.scoped)
      let seenExec: ToolExecution | undefined
      hub.ctx.on("tools/post-execute", async (exec, _result, next) => {
        seenExec = exec
        await next()
        return { kind: "accept" }
      })

      const registrySvc = yield* ToolRegistry.Service
      const def = yield* grepDef(registrySvc)
      yield* def.execute({ pattern: "needle", path: test.directory }, toolCtx())

      expect(seenExec).toBeDefined()
      expect(seenExec!.agent?.session?.header.id).toBe("ses_test")
      expect(seenExec!.agent?.session?.header.cwd).toBe(test.directory)
    }),
  )
})

describe("grep-bridge: abort interrupts the native fiber and still enters the waterfall", () => {
  bridgedIt.instance("aborting exec.signal maps to a fiber interrupt reaching post-execute", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const registry = yield* CordisHubService
      const hub = yield* registry.forDirectory(test.directory).pipe(Effect.scoped)
      // Mount Tools on the hub and register a never-completing grep body so
      // abort is observable through the full ctx.tools pipeline.
      if (!hub.ctx.get("tools")) {
        yield* Effect.promise(() => hub.mount(Tools, hub.runtime as never))
      }
      let seenError: boolean | undefined
      let aborted = false
      hub.ctx.tools.register({
        name: "grep",
        description: "search",
        parameters: {},
        execute: (args, exec) =>
          createGrepBridge(
            () =>
              Effect.sync(() => {
                // Signal that the fiber started, then hang forever.
                aborted = true
                return Effect.never
              }).pipe(Effect.flatten) as Effect.Effect<unknown>,
            hub.runtime as never,
          ).execute(args, exec),
      })

      hub.ctx.on("tools/post-execute", async (_exec, result, next) => {
        seenError = result.isError
        await next()
        return { kind: "accept" }
      })

      const controller = new AbortController()
      const pending = hub.ctx.tools.execute(
        "grep",
        { pattern: "never" },
        {
          callId: "call-1",
          rootCallId: "call-1",
          name: "grep",
          arguments: { pattern: "never" },
          agent: { session: { header: { id: "s1", cwd: testCwd() } } },
          signal: controller.signal,
        },
      )
      // Let the forked fiber register before aborting, then interrupt.
      yield* Effect.sleep("20 millis")
      controller.abort()

      const result = yield* Effect.promise(() => pending)
      expect(result.isError).toBe(true)
      expect(aborted).toBe(true)
      expect(seenError).toBe(true)
    }),
  )
})

function testCwd(): string {
  return process.cwd()
}
