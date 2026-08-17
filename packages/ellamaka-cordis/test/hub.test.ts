import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Context as CordisContext, Service } from "@deepseek-ai/cordis"
import { CordisHub } from "../src/hub"
import { cordisHubLayer, cordisHubLayerWith, CordisHubService } from "../src/layer"

// --- Test fixtures: cordis services/plugins shared across cases ---

declare module "@deepseek-ai/cordis" {
  interface Context {
    greet: GreetService
  }
}

class GreetService extends Service {
  static provide = "greet"
  constructor(ctx: CordisContext, public msg: string) {
    super(ctx, "greet")
  }
  greet() {
    return this.msg
  }
}

class GreetPlugin extends Service {
  static name = "greet-plugin"
  static inject = ["greet"]
  constructor(ctx: CordisContext) {
    super(ctx, "greet-plugin")
  }
}

// --- 1. Container mount / unmount ---

describe("CordisHub container lifecycle", () => {
  test("mounts a plugin and exposes its provided service on ctx", async () => {
    const hub = new CordisHub(null)
    await hub.mount(GreetService, "hello from cordis")
    await hub.mount(GreetPlugin)
    expect(hub.ctx.greet.greet()).toBe("hello from cordis")
    await hub.dispose()
  })
})

// --- 2. Service registration (duplicate detection) ---

describe("CordisHub service registration", () => {
  class DupA extends Service {
    static provide = "dupX"
    constructor(ctx: CordisContext) {
      super(ctx, "dupX")
    }
  }
  class DupB extends Service {
    static provide = "dupX"
    constructor(ctx: CordisContext) {
      super(ctx, "dupX")
    }
  }

  test("throws a cordis duplicate-service error when registering the same name twice", async () => {
    const hub = new CordisHub(null)
    await hub.mount(DupA)
    let error: unknown
    try {
      await hub.mount(DupB)
    } catch (e) {
      error = e
    }
    expect(error).toBeDefined()
    expect(String(error)).toMatch(/service "dupX" has been registered/)
    await hub.dispose()
  })
})

// --- 3. Event dispatch ---

describe("CordisHub event dispatch", () => {
  test("ctx.emit delivers the payload to listeners", async () => {
    const hub = new CordisHub(null)
    const received: unknown[] = []
    hub.ctx.on("evt", (payload: unknown) => {
      received.push(payload)
    })
    hub.ctx.emit("evt", { id: 42 })
    expect(received).toEqual([{ id: 42 }])
    await hub.dispose()
  })
})

// --- 4. dispose cleanup ---

describe("CordisHub dispose", () => {
  test("dispose awaits ctx.fiber.dispose and is idempotent", async () => {
    const hub = new CordisHub(null)
    let disposed = false
    const origDispose = hub.ctx.fiber.dispose.bind(hub.ctx.fiber)
    ;(hub.ctx.fiber as unknown as { dispose: typeof origDispose }).dispose = async () => {
      disposed = true
      return origDispose()
    }
    await hub.dispose()
    expect(disposed).toBe(true)
    // A second dispose is safe (idempotent).
    await hub.dispose()
    expect(disposed).toBe(true)
  })
})

// --- 5. Effect Layer integration (per-instance registry, DESIGN D-06) ---

/** Resolve the hub for a directory inside a self-contained scope. */
function hubFor(directory: string) {
  return Effect.scoped(
    Effect.gen(function* () {
      const registry = yield* CordisHubService
      return yield* registry.forDirectory(directory)
    }),
  )
}

describe("cordisHubLayer (per-instance registry)", () => {
  test("same directory resolves the same hub; different directories get different hubs", async () => {
    const rt = ManagedRuntime.make(cordisHubLayer)
    const first = await rt.runPromise(hubFor("/inst/a"))
    const firstAgain = await rt.runPromise(hubFor("/inst/a"))
    const second = await rt.runPromise(hubFor("/inst/b"))
    expect(firstAgain).toBe(first)
    expect(second).not.toBe(first)
    await rt.dispose()
  })

  test("each per-directory hub carries a working ManagedRuntime mount point", async () => {
    const rt = ManagedRuntime.make(cordisHubLayer)
    const value = await rt.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* CordisHubService
          const hub = yield* registry.forDirectory("/inst/a")
          expect(hub.runtime).not.toBeNull()
          return yield* Effect.promise(() => hub.runtime!.runPromise(Effect.succeed(7)))
        }),
      ),
    )
    expect(value).toBe(7)
    await rt.dispose()
  })

  test("a mounted service is reachable on the per-directory hub's context", async () => {
    const rt = ManagedRuntime.make(cordisHubLayer)
    const msg = await rt.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* CordisHubService
          const hub = yield* registry.forDirectory("/inst/a")
          yield* Effect.promise(() => hub.mount(GreetService, "via-layer"))
          return hub.ctx.greet.greet()
        }),
      ),
    )
    expect(msg).toBe("via-layer")
    await rt.dispose()
  })

  test("invalidate disposes the old hub and the next lookup builds a fresh one", async () => {
    const rt = ManagedRuntime.make(cordisHubLayer)
    const hub1 = await rt.runPromise(hubFor("/inst/a"))
    expect(hub1).toBeDefined()

    let disposed = false
    const origDispose = hub1.ctx.fiber.dispose.bind(hub1.ctx.fiber)
    ;(hub1.ctx.fiber as unknown as { dispose: typeof origDispose }).dispose = async () => {
      disposed = true
      return origDispose()
    }

    await rt.runPromise(
      Effect.gen(function* () {
        const registry = yield* CordisHubService
        yield* registry.invalidate("/inst/a")
      }),
    )
    await poll(() => disposed)

    const hub2 = await rt.runPromise(hubFor("/inst/a"))
    expect(hub2).not.toBe(hub1)
    await rt.dispose()
  })

  test("disposing the runtime (layer scope close) disposes every cached hub", async () => {
    const rt = ManagedRuntime.make(cordisHubLayer)
    let disposed = false
    const hub = await rt.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* CordisHubService
          const h = yield* registry.forDirectory("/inst/c")
          const origDispose = h.ctx.fiber.dispose.bind(h.ctx.fiber)
          ;(h.ctx.fiber as unknown as { dispose: typeof origDispose }).dispose = async () => {
            disposed = true
            return origDispose()
          }
          return h
        }),
      ),
    )
    expect(hub).toBeDefined()
    expect(disposed).toBe(false)
    await rt.dispose()
    await poll(() => disposed)
    expect(disposed).toBe(true)
  })
})

async function poll(predicate: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error("timed out waiting for predicate")
}

// --- 6. Hub-create hook (code-mount point for per-instance plugins) ---

describe("cordisHubLayerWith onHubCreate", () => {
  test("runs once per directory on first resolution; mounted services are reachable", async () => {
    const created: string[] = []
    const layer = cordisHubLayerWith({
      onHubCreate: async (hub, directory) => {
        created.push(directory)
        await hub.mount(GreetService, `greet-${directory}`)
      },
    })
    const rt = ManagedRuntime.make(layer)

    const msg = await rt.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* CordisHubService
          const hub = yield* registry.forDirectory("/inst/x")
          // The hook's mounted service is live on the hub before dispatch.
          return hub.ctx.greet.greet()
        }),
      ),
    )
    expect(msg).toBe("greet-/inst/x")

    // Second resolution of the same directory does not re-run the hook.
    await hubFor2(rt, "/inst/x")
    // A different directory runs it again, with its own hub.
    await hubFor2(rt, "/inst/y")
    expect(created).toEqual(["/inst/x", "/inst/y"])

    await rt.dispose()
  })

  test("a failing hook fails the resolution loudly (no silent hub)", async () => {
    const layer = cordisHubLayerWith({
      onHubCreate: async () => {
        throw new Error("plugin mount exploded")
      },
    })
    const rt = ManagedRuntime.make(layer)
    await expect(
      rt.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const registry = yield* CordisHubService
            return yield* registry.forDirectory("/inst/z")
          }),
        ),
      ),
    ).rejects.toThrow("plugin mount exploded")
    await rt.dispose()
  })

  function hubFor2(rt: ManagedRuntime.ManagedRuntime<CordisHubService, never>, directory: string) {
    return rt.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* CordisHubService
          return yield* registry.forDirectory(directory)
        }),
      ),
    )
  }
})
