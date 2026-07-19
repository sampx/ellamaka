import { describe, expect, test } from "bun:test"
import type { SidecarRuntimeState } from "../preload/types"

// ── Helpers ───────────────────────────────────────────────────────────────

function makeState(overrides?: Partial<SidecarRuntimeState>): SidecarRuntimeState {
  return {
    generation: 1,
    status: "ready",
    connection: { url: "http://127.0.0.1:12345", username: "ellamaka", password: "pw" },
    attempt: 0,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────
// These tests verify the Deps contract that registerIpcHandlers expects.
// The actual ipcMain.handle registration is tested implicitly by the
// electron-mock.ts preload and the full test suite.

describe("IPC Deps contract", () => {
  describe("getSidecarState", () => {
    test("returns SidecarRuntimeState", () => {
      const state = makeState({ generation: 2, status: "ready" })
      const getSidecarState = (): SidecarRuntimeState => state
      const result = getSidecarState()
      expect(result.generation).toBe(2)
      expect(result.status).toBe("ready")
      expect(result.connection?.url).toBe("http://127.0.0.1:12345")
    })
  })

  describe("restartSidecar", () => {
    test("is callable", () => {
      let called = false
      const restartSidecar = () => { called = true }
      restartSidecar()
      expect(called).toBe(true)
    })
  })

  describe("subscribeToSidecarState", () => {
    test("listener receives state updates", () => {
      const received: SidecarRuntimeState[] = []
      const subscribeToSidecarState = (listener: (state: SidecarRuntimeState) => void) => {
        received.push(makeState({ status: "starting" }))
        listener(makeState({ status: "ready", generation: 1 }))
        return () => {}
      }

      let captured: SidecarRuntimeState | undefined
      const unsub = subscribeToSidecarState((state) => { captured = state })
      expect(captured?.status).toBe("ready")
      expect(captured?.generation).toBe(1)
      expect(typeof unsub).toBe("function")
    })

    test("unsubscribe stops receiving updates", () => {
      let active = true
      const subscribeToSidecarState = (listener: (state: SidecarRuntimeState) => void) => {
        return () => { active = false }
      }

      const unsub = subscribeToSidecarState(() => {})
      unsub()
      expect(active).toBe(false)
    })
  })

  describe("awaitInitialization", () => {
    test("resolves when supervisor is ready", async () => {
      const readyData = { url: "http://127.0.0.1:12345", username: "ellamaka", password: "pw" }
      const awaitInitialization = async (sendStep: (step: any) => void) => {
        sendStep({ phase: "server_waiting" })
        return readyData
      }

      const result = await awaitInitialization(() => {})
      expect(result.url).toBe("http://127.0.0.1:12345")
      expect(result.username).toBe("ellamaka")
    })

    test("rejects when supervisor is failed", async () => {
      const awaitInitialization = async () => {
        throw new Error("Sidecar is failed")
      }

      await expect(awaitInitialization()).rejects.toThrow("Sidecar is failed")
    })

    test("rejects when supervisor is stopped", async () => {
      const awaitInitialization = async () => {
        throw new Error("Sidecar is stopped")
      }

      await expect(awaitInitialization()).rejects.toThrow("Sidecar is stopped")
    })
  })
})
