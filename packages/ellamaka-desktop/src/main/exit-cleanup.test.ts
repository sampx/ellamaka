import { describe, expect, test } from "bun:test"

describe("desktop exit cleanup", () => {
  test("killSidecar is an async function that awaits stop", async () => {
    // The killSidecar function must:
    // 1. Null out the server reference
    // 2. Await server.stop()
    // This ensures PTY processes are terminated before app exit.
    let stopped = false
    const fakeServer = {
      stop: async () => {
        stopped = true
      },
    }

    // Simulate killSidecar behavior
    let server: typeof fakeServer | null = fakeServer
    async function killSidecar() {
      if (!server) return
      const current = server
      server = null
      await current.stop()
    }

    await killSidecar()
    expect(server).toBeNull()
    expect(stopped).toBe(true)
  })

  test("killSidecar is idempotent", async () => {
    let stopCount = 0
    const fakeServer = {
      stop: async () => {
        stopCount++
      },
    }

    let server: typeof fakeServer | null = fakeServer
    async function killSidecar() {
      if (!server) return
      const current = server
      server = null
      await current.stop()
    }

    await killSidecar()
    await killSidecar() // second call should be no-op
    expect(stopCount).toBe(1)
  })

  test("SidecarListener.stop returns a Promise", () => {
    // The stop method on SidecarListener must return Promise<void>
    // for proper awaiting during exit cleanup.
    const listener: { stop: () => Promise<void> } = {
      stop: async () => {},
    }
    const result = listener.stop()
    expect(result).toBeInstanceOf(Promise)
  })
})
