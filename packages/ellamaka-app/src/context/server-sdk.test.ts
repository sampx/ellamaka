import { describe, expect, test } from "bun:test"
import { preserveServerSdkEventStatus, createServerSdkEventResync } from "./server-sdk"

describe("preserveServerSdkEventStatus", () => {
  test("keeps eventStatus reactive after preparing the provider value", () => {
    let status = "stopped"
    const sdk = {
      url: "http://localhost:4096",
      get eventStatus() {
        return status
      },
    }

    const provider = preserveServerSdkEventStatus(sdk, {})
    expect(provider.eventStatus).toBe("stopped")

    status = "connected"
    expect(provider.eventStatus).toBe("connected")
  })
})

describe("createServerSdkEventResync", () => {
  test("emits resync after a real disconnect, not on first connect", () => {
    const resync = createServerSdkEventResync()
    const seen: string[] = []
    resync.onResync(() => seen.push("resync"))

    resync.notifyConnected()
    expect(seen).toEqual([])

    resync.notifyDisconnected()
    resync.notifyConnected()
    expect(seen).toEqual(["resync"])

    resync.notifyDisconnected()
    resync.notifyConnected()
    expect(seen).toEqual(["resync", "resync"])
  })

  test("does not emit when stream ends without reconnect", () => {
    const resync = createServerSdkEventResync()
    const seen: string[] = []
    resync.onResync(() => seen.push("resync"))

    resync.notifyConnected()
    resync.notifyDisconnected()
    expect(seen).toEqual([])
  })
})
