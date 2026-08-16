import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { CordisHub } from "../src/hub"
import { AgentLoop } from "../src/agent-loop"

// --- Helpers ---

/** Build a hub wired with an AgentLoop service and a fresh ManagedRuntime. */
async function makeHub() {
  const runtime = ManagedRuntime.make(Layer.empty)
  const hub = new CordisHub(runtime)
  await hub.mount(AgentLoop, runtime)
  return { hub, runtime }
}

describe("ctx.agentLoop.run", () => {
  test("executes Effect work and returns its result", async () => {
    const { hub, runtime } = await makeHub()
    const log: string[] = []
    const result = await hub.ctx.agentLoop.run({
      sessionID: "s1",
      work: Effect.acquireRelease(
        Effect.sync(() => {
          log.push("acquire")
          return "hello"
        }),
        () => Effect.sync(() => log.push("release")),
      ),
    })
    expect(result).toBe("hello")
    expect(log).toEqual(["acquire", "release"])
    await runtime.dispose()
  })

  test("emits agent/turn-completed with sessionID on successful completion", async () => {
    const { hub, runtime } = await makeHub()
    const received: string[] = []
    hub.ctx.on("agent/turn-completed", (p: { sessionID: string }) => received.push(p.sessionID))
    await hub.ctx.agentLoop.run({
      sessionID: "s2",
      work: Effect.succeed("done"),
    })
    expect(received).toEqual(["s2"])
    await runtime.dispose()
  })

  test("interrupting the fiber runs finalizers child-before-parent and emits no event", async () => {
    const { hub, runtime } = await makeHub()
    const log: string[] = []
    const received: string[] = []
    hub.ctx.on("agent/turn-completed", (p: { sessionID: string }) => received.push(p.sessionID))

    const controller = new AbortController()
    const runPromise = hub.ctx.agentLoop.run({
      sessionID: "s3",
      signal: controller.signal,
      work: Effect.acquireRelease(
        Effect.sync(() => log.push("parent-acquire")),
        () => Effect.sync(() => log.push("parent-release")),
      ).pipe(
        Effect.flatMap(() =>
          Effect.acquireRelease(
            Effect.sync(() => log.push("child-acquire")),
            () => Effect.sync(() => log.push("child-release")),
          ).pipe(Effect.flatMap(() => Effect.never)),
        ),
      ),
    })

    // Wait for the work to acquire before aborting, so the interrupt is observable.
    await new Promise((resolve) => setTimeout(resolve, 50))
    controller.abort()

    await expect(runPromise).rejects.toBeDefined()
    expect(log).toEqual([
      "parent-acquire",
      "child-acquire",
      "child-release",
      "parent-release",
    ])
    expect(received).toEqual([])
    await runtime.dispose()
  })
})
