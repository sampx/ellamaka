import { describe, expect, test } from "bun:test"
import { preserveServerSdkEventStatus } from "./server-sdk"

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
