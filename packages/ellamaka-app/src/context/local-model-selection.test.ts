import { describe, expect, test } from "bun:test"
import {
  modelSelectionPersistTarget,
  resolveSessionModel,
  shouldApplyAgentSelection,
  shouldSyncSessionModel,
} from "./local-model-selection"
import { PersistTesting } from "@/utils/persist"

describe("model selection persistence", () => {
  test("keeps route-driven sessions in the workspace store", () => {
    const target = modelSelectionPersistTarget("/spaces/main")

    expect(target.key).toBe("workspace:model-selection")
    expect(target.legacy).toEqual(["model-selection.v1"])
  })

  test("isolates fixed Workbench sessions in the same space", () => {
    const first = modelSelectionPersistTarget("/spaces/main", "session-a")
    const second = modelSelectionPersistTarget("/spaces/main", "session-b")

    expect(first.storage).toBe(second.storage)
    expect(first.key).toBe("session:session-a:model-selection")
    expect(second.key).toBe("session:session-b:model-selection")
    expect(first.key).not.toBe(second.key)
  })

  test("preserves each fixed session value after another panel writes", () => {
    const first = modelSelectionPersistTarget("/spaces/shared", "session-a")
    const second = modelSelectionPersistTarget("/spaces/shared", "session-b")
    const storage = PersistTesting.localStorageWithPrefix(first.storage!)

    storage.setItem(first.key, '{"model":"model-a"}')
    storage.setItem(second.key, '{"model":"model-b"}')

    expect(storage.getItem(first.key)).toBe('{"model":"model-a"}')
    expect(storage.getItem(second.key)).toBe('{"model":"model-b"}')
  })
})

describe("session model synchronization", () => {
  test("preserves an explicit model selection", () => {
    expect(shouldSyncSessionModel({ modelSource: "selected" })).toBeFalse()
  })

  test("lets the last user message replace derived or legacy state", () => {
    expect(shouldSyncSessionModel({ modelSource: "message" })).toBeTrue()
    expect(shouldSyncSessionModel({})).toBeTrue()
    expect(shouldSyncSessionModel(undefined)).toBeTrue()
  })
})

describe("agent selection synchronization", () => {
  test("ignores a controlled Select notification for the current agent", () => {
    expect(shouldApplyAgentSelection("wopal", "wopal")).toBeFalse()
  })

  test("applies a real agent change", () => {
    expect(shouldApplyAgentSelection("wopal", "build")).toBeTrue()
    expect(shouldApplyAgentSelection(undefined, "wopal")).toBeTrue()
  })
})

describe("session model resolution", () => {
  const resolve = (input: {
    state?: { model?: string; modelSource?: "selected" | "message" }
    lastMessage?: string
    agentDefault?: string
    fallback?: string
  }) => resolveSessionModel({ ...input, valid: (model) => model !== "unavailable" })

  test("keeps an explicit selection ahead of session history", () => {
    expect(
      resolve({
        state: { model: "selected", modelSource: "selected" },
        lastMessage: "last-message",
        agentDefault: "agent-default",
        fallback: "fallback",
      }),
    ).toBe("selected")
  })

  test("uses the last user message ahead of the agent default after a reply", () => {
    expect(
      resolve({
        lastMessage: "hy3-free",
        agentDefault: "deepseek-v4-flash-free",
        fallback: "fallback",
      }),
    ).toBe("hy3-free")
  })

  test("does not let a stale message cache override loaded session history", () => {
    expect(
      resolve({
        state: { model: "old-default", modelSource: "message" },
        lastMessage: "hy3-free",
        agentDefault: "agent-default",
        fallback: "fallback",
      }),
    ).toBe("hy3-free")
  })

  test("does not treat a stale message cache as conversation history", () => {
    expect(
      resolve({
        state: { model: "old-message", modelSource: "message" },
        agentDefault: "agent-default",
        fallback: "fallback",
      }),
    ).toBe("agent-default")
  })

  test("falls back through the configured and available models", () => {
    expect(resolve({ agentDefault: "agent-default", fallback: "fallback" })).toBe("agent-default")
    expect(resolve({ agentDefault: "unavailable", fallback: "fallback" })).toBe("fallback")
  })
})
