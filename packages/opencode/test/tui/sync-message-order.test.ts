import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2"
import { mergeMessages } from "@/cli/cmd/tui/context/sync-merge"

/**
 * Build a minimal user message literal. Only the fields relevant to the
 * merge logic are populated; the rest are omitted because the pure function
 * under test only reads `id`, `role`, and `time`.
 */
function userMsg(id: string, created: number): Message {
  return {
    id,
    sessionID: "ses_test",
    role: "user",
    time: { created },
    agent: "test",
    model: { providerID: "test", modelID: "test" },
  }
}

/**
 * Build a minimal assistant message literal with all `Message.Assistant`
 * required fields populated. `completed` is optional to model the lifecycle
 * state (undefined = still running, number = finished).
 */
function assistantMsg(id: string, created: number, completed?: number): Message {
  const time: { created: number; completed?: number } = { created }
  if (completed != null) time.completed = completed
  return {
    id,
    sessionID: "ses_test",
    role: "assistant",
    time,
    parentID: "parent",
    modelID: "test",
    providerID: "test",
    mode: "primary",
    agent: "test",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "stop",
  }
}

/** Assert the array is strictly ascending by id (the sort contract). */
function expectOrdered(messages: Message[]) {
  for (let i = 1; i < messages.length; i++) {
    expect(messages[i]!.id > messages[i - 1]!.id).toBe(true)
  }
}

/** Read `time.completed` after narrowing the union to an assistant message. */
function completedOf(message: Message): number | undefined {
  return message.role === "assistant" ? message.time.completed : undefined
}

describe("mergeMessages", () => {
  test("race: event-added messages survive a sync() that does not include them", () => {
    // Events added m_A, m_B before session.sync() resolved.
    const existing = [userMsg("m_A", 1), userMsg("m_B", 2)]
    // API snapshot (taken before m_A/m_B were created) does not contain them.
    const incoming = [userMsg("m_0", 0)]

    const merged = mergeMessages(existing, incoming)

    expect(merged.map((m) => m.id)).toEqual(["m_0", "m_A", "m_B"])
    expectOrdered(merged)
  })

  test("mixed: store messages partially present in API response are reconciled, others kept", () => {
    // Store has 3 event messages; 2 are in the API response (with updated content).
    const existing = [userMsg("m_A", 1), userMsg("m_B", 2), userMsg("m_C", 3)]
    const incoming = [userMsg("m_A", 1), userMsg("m_B", 2)]

    const merged = mergeMessages(existing, incoming)

    expect(merged.map((m) => m.id)).toEqual(["m_A", "m_B", "m_C"])
    // m_A and m_B should be the incoming (API) versions.
    expect(merged[0]).toBe(incoming[0])
    expect(merged[1]).toBe(incoming[1])
    expectOrdered(merged)
  })

  test("API order crossing id order: result is strictly id-ordered (sort contract)", () => {
    // API returns by (time_created, id); here time order differs from id order.
    const existing: Message[] = []
    const incoming = [userMsg("m_2", 10), userMsg("m_1", 5), userMsg("m_3", 15)]

    const merged = mergeMessages(existing, incoming)

    expect(merged.map((m) => m.id)).toEqual(["m_1", "m_2", "m_3"])
    expectOrdered(merged)
  })

  test("new messages are inserted at the correct ordered position", () => {
    const existing = [userMsg("m_1", 1), userMsg("m_3", 3)]
    const incoming = [userMsg("m_2", 2)]

    const merged = mergeMessages(existing, incoming)

    expect(merged.map((m) => m.id)).toEqual(["m_1", "m_2", "m_3"])
    expectOrdered(merged)
  })

  test("empty existing is equivalent to inserting all incoming in id order", () => {
    const merged = mergeMessages([], [userMsg("m_3", 3), userMsg("m_1", 1), userMsg("m_2", 2)])
    expect(merged.map((m) => m.id)).toEqual(["m_1", "m_2", "m_3"])
    expectOrdered(merged)
  })

  test("order guarantee: arbitrary input combinations stay id-ascending", () => {
    const cases: [Message[], Message[]][] = [
      [[userMsg("m_1", 1), userMsg("m_3", 3)], [userMsg("m_2", 2), userMsg("m_4", 4)]],
      [[userMsg("m_2", 2), userMsg("m_4", 4)], [userMsg("m_1", 1), userMsg("m_3", 3)]],
      [[userMsg("m_1", 1), userMsg("m_2", 2)], [userMsg("m_1", 1), userMsg("m_3", 3)]],
      [[userMsg("m_5", 5)], [userMsg("m_1", 1), userMsg("m_2", 2), userMsg("m_3", 3)]],
    ]
    for (const [existing, incoming] of cases) {
      expectOrdered(mergeMessages(existing, incoming))
    }
  })
})

describe("lifecycle merge", () => {
  test("stale snapshot cannot regress a completed assistant (keep existing whole)", () => {
    // Event side already has the finished assistant.
    const existing = [assistantMsg("m_1", 1, 100)]
    // Snapshot was taken before completion landed: same id, no completed.
    const incoming = [assistantMsg("m_1", 1)]

    const merged = mergeMessages(existing, incoming)

    // Reference equality: the existing (completed) message is kept whole.
    expect(merged[0]).toBe(existing[0])
    expect(completedOf(merged[0]!)).toBe(100)
  })

  test("snapshot fills in a completion lost during an event gap (use incoming)", () => {
    // Event side has an unfinished assistant (no completed).
    const existing = [assistantMsg("m_1", 1)]
    // Snapshot has the completion.
    const incoming = [assistantMsg("m_1", 1, 100)]

    const merged = mergeMessages(existing, incoming)

    expect(merged[0]).toBe(incoming[0])
    expect(completedOf(merged[0]!)).toBe(100)
  })

  test("both sides completed or both incomplete: use incoming", () => {
    // Both completed.
    const incomingDone = assistantMsg("m_1", 1, 100)
    const bothDone = mergeMessages([assistantMsg("m_1", 1, 100)], [incomingDone])
    expect(bothDone[0]).toBe(incomingDone)
    expect(completedOf(bothDone[0]!)).toBe(100)

    // Both incomplete.
    const incomingPending = assistantMsg("m_1", 1)
    const bothPending = mergeMessages([assistantMsg("m_1", 1)], [incomingPending])
    expect(bothPending[0]).toBe(incomingPending)
    expect(completedOf(bothPending[0]!)).toBeUndefined()
  })

  test("user messages never take the lifecycle branch (use incoming)", () => {
    const existing = [userMsg("m_1", 1)]
    const incoming = [userMsg("m_1", 1)]

    const merged = mergeMessages(existing, incoming)

    expect(merged[0]).toBe(incoming[0])
  })
})
