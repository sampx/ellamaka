import { describe, expect, test } from "bun:test"
import { mapSidecarStateToAction, type SidecarAdapterAction } from "./sidecar-adapter"
import type { SidecarRuntimeState } from "../../preload/types"

describe("mapSidecarStateToAction", () => {
  const baseState: SidecarRuntimeState = {
    generation: 0,
    status: "stopped",
    attempt: 0,
  }

  const connection = {
    url: "http://127.0.0.1:12345",
    username: "ellamaka",
    password: "test-password",
  }

  test("starting → wait", () => {
    const state: SidecarRuntimeState = { ...baseState, status: "starting" }
    const result = mapSidecarStateToAction(state, 0)
    expect(result).toEqual({ action: "wait" })
  })

  test("ready (generation=1, first) → connect", () => {
    const state: SidecarRuntimeState = {
      ...baseState,
      status: "ready",
      generation: 1,
      connection,
    }
    const result = mapSidecarStateToAction(state, 0)
    expect(result.action).toBe("connect")
    if (result.action === "connect") {
      expect(result.server.type).toBe("sidecar")
      expect(result.server.http.url).toBe("http://127.0.0.1:12345")
      expect(result.server.http.username).toBe("ellamaka")
      expect(result.server.http.password).toBe("test-password")
    }
  })

  test("ready (generation=2, changed) → reconnect", () => {
    const state: SidecarRuntimeState = {
      ...baseState,
      status: "ready",
      generation: 2,
      connection,
    }
    const result = mapSidecarStateToAction(state, 1)
    expect(result.action).toBe("reconnect")
    if (result.action === "reconnect") {
      expect(result.server.type).toBe("sidecar")
    }
  })

  test("ready (generation unchanged) → preserve", () => {
    const state: SidecarRuntimeState = {
      ...baseState,
      status: "ready",
      generation: 1,
      connection,
    }
    const result = mapSidecarStateToAction(state, 1)
    expect(result).toEqual({ action: "preserve" })
  })

  test("lost → preserve", () => {
    const state: SidecarRuntimeState = { ...baseState, status: "lost", errorCode: "EXIT_1" }
    const result = mapSidecarStateToAction(state, 0)
    expect(result).toEqual({ action: "preserve" })
  })

  test("restarting → preserve", () => {
    const state: SidecarRuntimeState = { ...baseState, status: "restarting" }
    const result = mapSidecarStateToAction(state, 0)
    expect(result).toEqual({ action: "preserve" })
  })

  test("failed → offline", () => {
    const state: SidecarRuntimeState = { ...baseState, status: "failed", errorCode: "EXIT_1" }
    const result = mapSidecarStateToAction(state, 0)
    expect(result).toEqual({ action: "offline" })
  })

  test("stopped → exit", () => {
    const state: SidecarRuntimeState = { ...baseState, status: "stopped" }
    const result = mapSidecarStateToAction(state, 0)
    expect(result).toEqual({ action: "exit" })
  })

  test("ready without connection → preserve", () => {
    const state: SidecarRuntimeState = {
      ...baseState,
      status: "ready",
      generation: 1,
    }
    const result = mapSidecarStateToAction(state, 0)
    expect(result).toEqual({ action: "preserve" })
  })
})
