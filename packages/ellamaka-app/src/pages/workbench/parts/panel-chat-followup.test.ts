import { describe, expect, test } from "bun:test"
import { nextFollowupToSend } from "./panel-chat-followup"

type Item = { id: string }

describe("PanelChat followup delivery", () => {
  test("keeps a queued item retractable while the current turn is still busy", () => {
    const queued: Item[] = [{ id: "msg_followup" }]

    expect(
      nextFollowupToSend(queued, {
        busy: true,
        sending: false,
        failedID: undefined,
        paused: false,
        child: false,
        blocked: false,
      }),
    ).toBeUndefined()
  })

  test("dispatches the first item after the current turn becomes idle", () => {
    const queued: Item[] = [{ id: "msg_followup" }]

    expect(
      nextFollowupToSend(queued, {
        busy: false,
        sending: false,
        failedID: undefined,
        paused: false,
        child: false,
        blocked: false,
      }),
    ).toEqual(queued[0])
  })
})
