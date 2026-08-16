import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Part, ToolPart, UserMessage } from "@opencode-ai/sdk/v2"
import {
  agentDisplayName,
  classifyPart,
  createBoundedExpansionState,
  defaultExpanded,
  extractPromptSummary,
  formatTurnDuration,
  isRenderablePart,
  partTitle,
  type PartClassification,
} from "./chat-render.utils"

function userMessage(id: string): UserMessage {
  return {
    id,
    sessionID: "ses_1",
    role: "user",
    time: { created: 1000 },
    agent: "primary",
    model: { providerID: "openai", modelID: "gpt-4o" },
  }
}

function assistantMessage(id: string, parentID: string, opts: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id,
    sessionID: "ses_1",
    role: "assistant",
    time: { created: 2000, completed: 3000 },
    parentID,
    modelID: "gpt-4o",
    providerID: "openai",
    mode: "primary",
    agent: "primary",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...opts,
  }
}

function textPart(id: string, messageID: string, text: string, synthetic?: boolean): Part {
  return { id, sessionID: "ses_1", messageID, type: "text", text, synthetic }
}

function toolPart(id: string, messageID: string, tool: string, callID: string): Part {
  return {
    id,
    sessionID: "ses_1",
    messageID,
    type: "tool",
    callID,
    tool,
    state: { status: "completed", input: {}, output: "", title: tool, metadata: {}, time: { start: 0, end: 1 } },
  }
}

function reasoningPart(id: string, messageID: string, text: string): Part {
  return { id, sessionID: "ses_1", messageID, type: "reasoning", text, time: { start: 0, end: 1 } }
}

function filePart(id: string, messageID: string): Part {
  return { id, sessionID: "ses_1", messageID, type: "file", mime: "text/plain", url: "file:///a.ts" }
}

function agentPart(id: string, messageID: string): Part {
  return { id, sessionID: "ses_1", messageID, type: "agent", name: "primary" }
}

function subtaskPart(id: string, messageID: string): Part {
  return {
    id,
    sessionID: "ses_1",
    messageID,
    type: "subtask",
    prompt: "do it",
    description: "a subtask",
    agent: "primary",
  }
}

function compactionPart(id: string, messageID: string): Part {
  return { id, sessionID: "ses_1", messageID, type: "compaction", auto: true }
}

function retryPart(id: string, messageID: string): Part {
  return {
    id,
    sessionID: "ses_1",
    messageID,
    type: "retry",
    attempt: 1,
    error: { name: "APIError", data: { message: "x", isRetryable: true } },
    time: { created: 0 },
  }
}

describe("isRenderablePart", () => {
  test("hides step-start, step-finish, snapshot and patch parts", () => {
    const msg = assistantMessage("a1", "u1")
    expect(isRenderablePart({ id: "1", sessionID: "s", messageID: "a1", type: "step-start" }, msg)).toBe(false)
    expect(isRenderablePart({ id: "2", sessionID: "s", messageID: "a1", type: "step-finish", reason: "x", cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, msg)).toBe(false)
    expect(isRenderablePart({ id: "3", sessionID: "s", messageID: "a1", type: "snapshot", snapshot: "x" }, msg)).toBe(false)
    expect(isRenderablePart({ id: "4", sessionID: "s", messageID: "a1", type: "patch", hash: "x", files: [] }, msg)).toBe(false)
  })

  test("hides synthetic text when the assistant message is not running", () => {
    const msg = assistantMessage("a1", "u1") // completed
    const part = textPart("p1", "a1", "temp", true)
    expect(isRenderablePart(part, msg)).toBe(false)
  })

  test("shows synthetic text while the assistant message is running", () => {
    const msg = assistantMessage("a1", "u1", { time: { created: 2000 } }) // running
    const part = textPart("p1", "a1", "temp", true)
    expect(isRenderablePart(part, msg)).toBe(true)
  })

  test("shows normal text parts", () => {
    const msg = assistantMessage("a1", "u1")
    expect(isRenderablePart(textPart("p1", "a1", "hi"), msg)).toBe(true)
  })

  test("hides todowrite and todoread tool parts", () => {
    const msg = assistantMessage("a1", "u1")
    expect(isRenderablePart(toolPart("t1", "a1", "todowrite", "c1"), msg)).toBe(false)
    expect(isRenderablePart(toolPart("t2", "a1", "todoread", "c2"), msg)).toBe(false)
    expect(isRenderablePart(toolPart("t3", "a1", "bash", "c3"), msg)).toBe(true)
  })
})

describe("classifyPart", () => {
  test("classifies user input parts by role", () => {
    const u = userMessage("u1")
    expect(classifyPart(filePart("f1", "u1"), u).kind).toBe("user")
    expect(classifyPart(agentPart("g1", "u1"), u).kind).toBe("user")
    expect(classifyPart(subtaskPart("s1", "u1"), u).kind).toBe("user")
  })

  test("classifies assistant text and reasoning", () => {
    const a = assistantMessage("a1", "u1")
    expect(classifyPart(textPart("p1", "a1", "hi"), a).kind).toBe("narrative")
    expect(classifyPart(reasoningPart("r1", "a1", "think"), a).kind).toBe("reasoning")
  })

  test("classifies context tools", () => {
    const a = assistantMessage("a1", "u1")
    for (const tool of ["read", "glob", "grep", "list"]) {
      expect(classifyPart(toolPart("t1", "a1", tool, "c1"), a).kind).toBe("context")
    }
  })

  test("classifies shell, file change, subagent and question tools", () => {
    const a = assistantMessage("a1", "u1")
    expect(classifyPart(toolPart("t1", "a1", "bash", "c1"), a).kind).toBe("shell")
    expect(classifyPart(toolPart("t2", "a1", "edit", "c2"), a).kind).toBe("file-change")
    expect(classifyPart(toolPart("t3", "a1", "write", "c3"), a).kind).toBe("file-change")
    expect(classifyPart(toolPart("t4", "a1", "apply_patch", "c4"), a).kind).toBe("file-change")
    expect(classifyPart(toolPart("t5", "a1", "task", "c5"), a).kind).toBe("subagent")
    expect(classifyPart(toolPart("t7", "a1", "question", "c7"), a).kind).toBe("interaction")
  })

  test("classifies wopal_task as subagent and todo tools as generic", () => {
    const a = assistantMessage("a1", "u1")
    expect(classifyPart(toolPart("t1", "a1", "wopal_task", "c1"), a).kind).toBe("subagent")
    expect(classifyPart(toolPart("t2", "a1", "todowrite", "c2"), a).kind).toBe("generic")
    expect(classifyPart(toolPart("t3", "a1", "todoread", "c3"), a).kind).toBe("generic")
  })

  test("classifies web tools as generic so the generic renderer shows them", () => {
    const a = assistantMessage("a1", "u1")
    expect(classifyPart(toolPart("t1", "a1", "webfetch", "c1"), a).kind).toBe("generic")
    expect(classifyPart(toolPart("t2", "a1", "websearch", "c2"), a).kind).toBe("generic")
    expect(classifyPart(toolPart("t3", "a1", "memory_manage", "c3"), a).kind).toBe("generic")
    expect(classifyPart(toolPart("t4", "a1", "skill", "c4"), a).kind).toBe("generic")
  })

  test("classifies unknown tools as generic", () => {
    const a = assistantMessage("a1", "u1")
    expect(classifyPart(toolPart("t1", "a1", "some_mcp_tool", "c1"), a).kind).toBe("generic")
  })

  test("classifies compaction and retry", () => {
    const a = assistantMessage("a1", "u1")
    expect(classifyPart(compactionPart("c1", "a1"), a).kind).toBe("compaction")
    expect(classifyPart(retryPart("r1", "a1"), a).kind).toBe("retry")
  })

  test("falls back to generic for unknown part types", () => {
    const a = assistantMessage("a1", "u1")
    const unknown = { id: "x", sessionID: "s", messageID: "a1", type: "future-part" } as unknown as Part
    expect(classifyPart(unknown, a).kind).toBe("generic")
  })
})

describe("partTitle", () => {
  test("returns a descriptive title for tool parts", () => {
    const a = assistantMessage("a1", "u1")
    const bash = toolPart("t1", "a1", "bash", "c1")
    expect(partTitle(bash, a)).toContain("bash")
  })
})

describe("defaultExpanded", () => {
  test("expands running blocks and collapses completed history", () => {
    const a = assistantMessage("a1", "u1")
    const running: ToolPart = toolPart("t1", "a1", "bash", "c1") as ToolPart
    running.state = { status: "running", input: {}, time: { start: 0 } }
    expect(defaultExpanded(running, a)).toBe(true)

    const completed = toolPart("t2", "a1", "bash", "c2")
    expect(defaultExpanded(completed, a)).toBe(false)
  })

  test("keeps errors expanded", () => {
    const a = assistantMessage("a1", "u1")
    const err: ToolPart = toolPart("t1", "a1", "bash", "c1") as ToolPart
    err.state = { status: "error", input: {}, error: "boom", time: { start: 0, end: 1 } }
    expect(defaultExpanded(err, a)).toBe(true)
  })
})

describe("extractPromptSummary", () => {
  test("prefers the first valid text part for the user summary", () => {
    const u = userMessage("u1")
    const parts = [textPart("p1", "u1", "  **hello** world  "), textPart("p2", "u1", "second")]
    const summary = extractPromptSummary({ message: u, parts })
    expect(summary).toBe("hello world")
  })

  test("returns a stable status summary for empty replies", () => {
    const u = userMessage("u1")
    const summary = extractPromptSummary({ message: u, parts: [] })
    expect(summary).toBe("")
  })

  test("returns a stable status summary for running replies", () => {
    const u = userMessage("u1")
    const a = assistantMessage("a1", "u1", { time: { created: 2000 } })
    const summary = extractPromptSummary({ message: u, parts: [textPart("p1", "a1", "x")], assistant: [a] })
    expect(summary).toBe("正在回复…")
  })
})

describe("createBoundedExpansionState", () => {
  test("stores and reads expansion keys", () => {
    const state = createBoundedExpansionState(10)
    state.set("ses_1", "bash", "c1", true)
    expect(state.get("ses_1", "bash", "c1")).toBe(true)
    expect(state.get("ses_1", "bash", "c2")).toBeUndefined()
  })

  test("evicts the oldest entry when the limit is reached", () => {
    const state = createBoundedExpansionState(2)
    state.set("s", "bash", "c1", true)
    state.set("s", "bash", "c2", true)
    state.set("s", "bash", "c3", true)
    expect(state.get("s", "bash", "c1")).toBeUndefined()
    expect(state.get("s", "bash", "c2")).toBe(true)
    expect(state.get("s", "bash", "c3")).toBe(true)
  })
})

describe("agentDisplayName", () => {
  test("capitalizes the first letter of an agent identifier", () => {
    expect(agentDisplayName("fae")).toBe("Fae")
    expect(agentDisplayName("rook")).toBe("Rook")
  })

  test("returns an empty string for an empty agent name", () => {
    expect(agentDisplayName("")).toBe("")
  })
})

describe("formatTurnDuration", () => {
  test("formats sub-minute durations as seconds", () => {
    expect(formatTurnDuration(45_000)).toBe("45s")
  })

  test("formats longer durations as minutes and seconds", () => {
    expect(formatTurnDuration(73_000)).toBe("1m 13s")
    expect(formatTurnDuration(600_000)).toBe("10m 0s")
  })

  test("rejects negative or non-finite durations", () => {
    expect(formatTurnDuration(-1)).toBe("")
    expect(formatTurnDuration(Number.NaN)).toBe("")
  })
})
