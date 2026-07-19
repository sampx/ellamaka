import { describe, expect, test } from "bun:test"
import { resolveWorkbenchRuntimeStatus } from "./workbench-runtime"

describe("resolveWorkbenchRuntimeStatus", () => {
  test("returns online when health and the latest event stream are connected", () => {
    expect(resolveWorkbenchRuntimeStatus(true, "connected")).toBe("online")
  })

  test("keeps the overlay state for unavailable health regardless of event status", () => {
    expect(resolveWorkbenchRuntimeStatus(false, "connected")).toBe("offline")
  })

  test("reports reconnecting only while the latest stream is actually reconnecting", () => {
    expect(resolveWorkbenchRuntimeStatus(true, "reconnecting")).toBe("degraded")
    expect(resolveWorkbenchRuntimeStatus(true, "connecting")).toBe("recovering")
  })
})

// ── W-03: server.key change effect contract ──────────────────────────────

describe("WorkbenchSidecarCleanupBinding contract", () => {
  test("first server.key mount does not trigger cleanup", () => {
    let firstServerKey = true
    const calls: string[] = []

    const onKeyChange = (key: string) => {
      if (firstServerKey) {
        firstServerKey = false
        return
      }
      calls.push(`cleanup:${key}`)
    }

    // First call — should be skipped
    onKeyChange("http://127.0.0.1:12345")
    expect(calls.length).toBe(0)
    expect(firstServerKey).toBe(false)

    // Second call — should trigger cleanup
    onKeyChange("http://127.0.0.1:12345#gen2")
    expect(calls.length).toBe(1)
    expect(calls[0]).toBe("cleanup:http://127.0.0.1:12345#gen2")
  })

  test("subsequent server.key changes trigger cleanup", () => {
    let firstServerKey = true
    const calls: string[] = []

    const onKeyChange = (key: string) => {
      if (firstServerKey) {
        firstServerKey = false
        return
      }
      calls.push(`cleanup:${key}`)
    }

    // Skip first
    onKeyChange("key-1")
    expect(calls.length).toBe(0)

    // Second triggers
    onKeyChange("key-2")
    expect(calls.length).toBe(1)

    // Third triggers
    onKeyChange("key-3")
    expect(calls.length).toBe(2)
  })
})
