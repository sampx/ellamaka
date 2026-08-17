import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { readFileSync } from "node:fs"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ToolRegistry, GrepBridgeService } from "@/tool/registry"
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
import { cordisHubLayer, createGrepBridgeLayer, CordisHubService, mountSpillPlugins } from "@wopal/ellamaka-cordis"
import type { CordisHub } from "@wopal/ellamaka-cordis"
import { CordisMount } from "@/server/cordis-mount"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { SessionID, MessageID } from "@/session/schema"

const node = CrossSpawnSpawner.defaultLayer
const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

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

// Registry + cordis grep-bridge assembly. Spill plugins are mounted per-test on
// the hub's context, so unmount is exercised by disposing those plugin fibers.
const bridgedRegistryLayer = Layer.mergeAll(
  registryLayer(),
  cordisHubLayer,
  createGrepBridgeLayer(GrepBridgeService).pipe(Layer.provide(cordisHubLayer)),
)

const bridgedIt = testEffect(Layer.mergeAll(bridgedRegistryLayer, node, Agent.defaultLayer))

// Production-assembly shape: per-instance hubs come from the production
// assembly FACTORY (onHubCreate code-mounts the spill trio, no manual
// mounting) and the grep bridge routes through those hubs. Only the spill
// root is redirected to a temp dir so tests never write into the real data
// dir - same code path as production, only parameters differ.
const prodSpillRoot = mkdtempSync(path.join(tmpdir(), "cordis-prod-spill-"))
const prodAssembly = CordisMount.createCordisPluginAssembly({ spillRoot: prodSpillRoot })
const prodShapeIt = testEffect(
  Layer.mergeAll(
    registryLayer(),
    prodAssembly.hubs,
    prodAssembly.grepBridge,
    node,
    Agent.defaultLayer,
  ),
)

/** Minimal tool context used to drive a registry grep def directly. */
function toolCtx(abort = new AbortController().signal): Tool.Context {
  return {
    sessionID: SessionID.make("ses_spill"),
    messageID: MessageID.make("msg_spill"),
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

/**
 * Write a file whose grep match output is large enough to spill but under the
 * native truncation budget (50KB default), so the full text reaches the policy.
 * The file lives in a `src/` subdirectory so greps scoped to that subdir never
 * match the sibling `.spill` dump directory.
 */
async function writeBigFile(dir: string): Promise<string> {
  const srcDir = path.join(dir, "src")
  await Bun.write(path.join(srcDir, ".keep"), "")
  const lines = Array.from({ length: 500 }, (_, i) => `spill-${i} aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ${i}`)
  const content = lines.join("\n") + "\n"
  await Bun.write(path.join(srcDir, "big.txt"), content)
  return content
}

/** The spill locator path extracted from a spill notice, or `undefined`. */
function spillPathFrom(text: string): string | undefined {
  const match = /stored at: (\S+?)\. Use /.exec(text)
  return match?.[1]
}

/** Mount the spill trio on the hub and return the plugin fibers for unmount. */
async function mountSpill(hub: CordisHub, root: string) {
  const maxInlineBytes = 1000
  return mountSpillPlugins(hub.ctx, { root, maxInlineBytes })
}

describe("spill-conversation: real grep oversized output is spilled", () => {
  bridgedIt.instance("model sees preview + locator; dump file holds the full grep output", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const full = yield* Effect.promise(() => writeBigFile(test.directory))
      const hubRegistry = yield* CordisHubService
      const hub = yield* hubRegistry.forDirectory(test.directory).pipe(Effect.scoped)
      const mounted = yield* Effect.promise(() =>
        mountSpill(hub, path.join(test.directory, ".spill")),
      )
      const maxInlineBytes = 1000

      const registry = yield* ToolRegistry.Service
      const def = yield* grepDef(registry)
      const srcDir = path.join(test.directory, "src")
      const result = yield* def.execute({ pattern: "spill-", path: srcDir }, toolCtx())

      const text = result.output
      // The native grep output is far larger than the policy cap.
      expect(full.length).toBeGreaterThan(maxInlineBytes)
      // The model-facing content is a bounded preview + locator, not the full
      // formatted grep output: it is capped and carries the spill notice.
      expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(maxInlineBytes)
      expect(text).toContain("Full formatted result stored at:")
      expect(text).toContain("Omitted")

      // The dump file exists on disk and holds the FULL formatted grep output:
      // it reaches the truncation note and the last shown line, and is larger
      // than the bounded model-facing preview.
      const spillPath = spillPathFrom(text)
      expect(spillPath).toBeDefined()
      expect(spillPath!.startsWith(path.join(test.directory, ".spill"))).toBe(true)
      const dump = readFileSync(spillPath!, "utf8")
      expect(dump).toContain("showing 100 of 500")
      expect(dump).toContain("Line 100")
      expect(Buffer.byteLength(dump, "utf8")).toBeGreaterThan(Buffer.byteLength(text, "utf8"))
    }),
  )

  bridgedIt.instance("unmount restores inline behavior: no replacement after the spill fibers are disposed", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => writeBigFile(test.directory))
      const hubRegistry = yield* CordisHubService
      const hub = yield* hubRegistry.forDirectory(test.directory).pipe(Effect.scoped)
      const mounted = yield* Effect.promise(() =>
        mountSpill(hub, path.join(test.directory, ".spill")),
      )

      const registry = yield* ToolRegistry.Service
      const def = yield* grepDef(registry)
      const srcDir = path.join(test.directory, "src")

      // First dispatch is spilled: model sees a preview + locator.
      const spilled = yield* def.execute({ pattern: "spill-", path: srcDir }, toolCtx())
      expect(spilled.output).toContain("Full formatted result stored at:")

      // Unload the spill plugins (dispose their fibers).
      yield* Effect.promise(() => mounted.store.dispose())
      yield* Effect.promise(() => mounted.policy.dispose())

      // Subsequent dispatch is NOT replaced: the full inline grep output returns.
      const restored = yield* def.execute({ pattern: "spill-", path: srcDir }, toolCtx())
      expect(restored.output).toContain("showing 100 of 500")
      expect(restored.output).not.toContain("Full formatted result stored at:")
    }),
  )
})

describe("spill-conversation: production assembly (code-mounted, end-to-end)", () => {
  prodShapeIt.instance(
    "grep dispatches spill automatically via the production plugin assembly",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        // Long lines so the native-truncated output (~100 lines shown) still
        // exceeds the production 20KB inline cap.
        const srcDir = path.join(test.directory, "src")
        yield* Effect.promise(() => Bun.write(path.join(srcDir, ".keep"), ""))
        const lines = Array.from(
          { length: 500 },
          (_, i) => `prod-${i} ${"b".repeat(300)}`,
        )
        const content = lines.join("\n") + "\n"
        yield* Effect.promise(() => Bun.write(path.join(srcDir, "big.txt"), content))

        // No manual mounting anywhere: the registry def routes through the
        // production hub assembly (grep bridge + code-mounted spill trio).
        const registry = yield* ToolRegistry.Service
        const def = yield* grepDef(registry)
        const result = yield* def.execute({ pattern: "prod-", path: srcDir }, toolCtx())

        const text = result.output
        expect(text).toContain("Full formatted result stored at:")
        expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(CordisMount.SPILL_MAX_INLINE_BYTES)

        // The dump lands under the assembly's spill root and holds the full
        // formatted output (larger than the bounded model-facing preview).
        const spillPath = spillPathFrom(text)
        expect(spillPath).toBeDefined()
        expect(spillPath!.startsWith(prodSpillRoot)).toBe(true)
        const dump = readFileSync(spillPath!, "utf8")
        expect(dump).toContain("showing 100 of 500")
        expect(Buffer.byteLength(dump, "utf8")).toBeGreaterThan(
          Buffer.byteLength(text, "utf8"),
        )
      }),
  )
})
