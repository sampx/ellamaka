import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Context as CordisContext, Service } from "@deepseek-ai/cordis"
import { CordisHub } from "../src/hub"
import { cordisHubInstance, cordisHubLayer } from "../src/layer"

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

// --- 5. Effect Layer integration ---

describe("cordisHubLayer (Effect integration)", () => {
  test("captures a ManagedRuntime mount point usable by bridge services", async () => {
    const program = Effect.gen(function* () {
      const hub = yield* cordisHubInstance
      expect(hub.runtime).not.toBeNull()
      const runtime = hub.runtime!
      const value = yield* Effect.promise(() => runtime.runPromise(Effect.succeed(7)))
      expect(value).toBe(7)
      yield* Effect.promise(() => hub.dispose())
      return true
    })
    const rt = ManagedRuntime.make(cordisHubLayer)
    expect(await rt.runPromise(program)).toBe(true)
    await rt.dispose()
  })

  test("provides a per-scope CordisHub whose mounted service is reachable", async () => {
    const program = Effect.gen(function* () {
      const hub = yield* cordisHubInstance
      yield* Effect.promise(() => hub.mount(GreetService, "via-layer"))
      const msg = hub.ctx.greet.greet()
      yield* Effect.promise(() => hub.dispose())
      return msg
    })
    const rt = ManagedRuntime.make(cordisHubLayer)
    const msg = await rt.runPromise(program)
    expect(msg).toBe("via-layer")
    await rt.dispose()
  })

  test("finalizer disposes the hub when the runtime is disposed", async () => {
    let hub: CordisHub | undefined
    let disposed = false
    const program = Effect.gen(function* () {
      hub = yield* cordisHubInstance
      const origDispose = hub.ctx.fiber.dispose.bind(hub.ctx.fiber)
      ;(hub.ctx.fiber as unknown as { dispose: typeof origDispose }).dispose = async () => {
        disposed = true
        return origDispose()
      }
      return hub
    })
    const rt = ManagedRuntime.make(cordisHubLayer)
    const got = await rt.runPromise(program)
    expect(got).toBeDefined()
    expect(hub).toBeDefined()
    // Layer build scope lives on the runtime; disposing the runtime runs the
    // layer's finalizer, which disposes the hub.
    expect(disposed).toBe(false)
    await rt.dispose()
    expect(disposed).toBe(true)
  })
})
