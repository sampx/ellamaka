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
