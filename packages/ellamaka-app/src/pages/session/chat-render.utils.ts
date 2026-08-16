import type { AssistantMessage, Message, Part, UserMessage } from "@opencode-ai/sdk/v2"

/**
 * Part classification for the Workbench Chat render layer. Classification reads
 * both the SDK part type and the owning message role so that `file`, `agent`
 * and `subtask` parts are treated as user input while assistant activity is
 * driven by `text`, `reasoning` and `tool` parts. Unknown combinations fall
 * back to a safe generic presentation.
 */
export type PartClassification =
  | { kind: "user" }
  | { kind: "narrative" }
  | { kind: "reasoning" }
  | { kind: "context" }
  | { kind: "shell" }
  | { kind: "file-change" }
  | { kind: "subagent" }
  | { kind: "interaction" }
  | { kind: "generic" }
  | { kind: "compaction" }
  | { kind: "retry" }

const CONTEXT_TOOLS = new Set(["read", "glob", "grep", "list"])
const SHELL_TOOLS = new Set(["bash", "shell"])
const FILE_CHANGE_TOOLS = new Set(["edit", "write", "apply_patch"])

const HIDDEN_PART_TYPES = new Set(["step-start", "step-finish", "snapshot", "patch"])

/** Todo tools render in the composer todo dock, never in the transcript. */
const HIDDEN_TOOLS = new Set(["todowrite", "todoread"])

function isAssistantMessage(message: Message): message is AssistantMessage {
  return message.role === "assistant"
}

function isRunning(message: AssistantMessage): boolean {
  return typeof message.time.completed !== "number"
}

/**
 * Returns whether a part should enter the transcript. Internal snapshot/patch
 * and step markers are hidden. Synthetic text is only shown while its owning
 * assistant message is still running and hidden once it completes. Todo tool
 * parts are owned by the composer todo dock and never enter the transcript.
 */
export function isRenderablePart(part: Part, message: Message): boolean {
  if (HIDDEN_PART_TYPES.has(part.type)) return false
  if (part.type === "tool" && HIDDEN_TOOLS.has(part.tool)) return false
  if (part.type === "text" && part.synthetic) {
    return isAssistantMessage(message) && isRunning(message)
  }
  return true
}

/**
 * Classifies a part into a render category. The owning message role is used to
 * disambiguate user-input parts from assistant activity.
 */
export function classifyPart(part: Part, message: Message): PartClassification {
  if (message.role === "user") {
    if (part.type === "file" || part.type === "agent" || part.type === "subtask") return { kind: "user" }
  }

  switch (part.type) {
    case "text":
      return { kind: "narrative" }
    case "reasoning":
      return { kind: "reasoning" }
    case "compaction":
      return { kind: "compaction" }
    case "retry":
      return { kind: "retry" }
    case "tool": {
      const tool = part.tool
      if (CONTEXT_TOOLS.has(tool)) return { kind: "context" }
      if (SHELL_TOOLS.has(tool)) return { kind: "shell" }
      if (FILE_CHANGE_TOOLS.has(tool)) return { kind: "file-change" }
      if (tool === "task" || tool === "wopal_task") return { kind: "subagent" }
      if (tool === "question") return { kind: "interaction" }
      return { kind: "generic" }
    }
    default:
      return { kind: "generic" }
  }
}

/**
 * Returns a short, descriptive title for a part. Tool parts use their tool name
 * and a best-effort input field; other parts fall back to a type label.
 */
export function partTitle(part: Part, _message: Message): string {
  if (part.type === "tool") {
    const input = part.state.input
    const command = typeof input.command === "string" ? input.command : undefined
    const filePath = typeof input.filePath === "string" ? input.filePath : undefined
    const pattern = typeof input.pattern === "string" ? input.pattern : undefined
    const detail = command ?? filePath ?? pattern
    return detail ? `${part.tool}: ${detail}` : part.tool
  }
  return part.type
}

/**
 * Default expansion policy for a part. Running blocks and errors stay expanded;
 * completed history collapses. User manual selection overrides this via the
 * bounded expansion state.
 */
export function defaultExpanded(part: Part, message: Message): boolean {
  if (part.type === "tool") {
    if (part.state.status === "running") return true
    if (part.state.status === "error") return true
    return false
  }
  if (part.type === "reasoning") {
    return isAssistantMessage(message) && isRunning(message)
  }
  return true
}

/**
 * Extracts a stable prompt summary for the PromptNavigator. The user summary
 * prefers the first valid text part; the assistant summary prefers the last
 * narrative text block. Empty, running or error replies produce a stable
 * status summary.
 */
export function extractPromptSummary(input: {
  message: UserMessage
  parts: Part[]
  assistant?: AssistantMessage[]
}): string {
  const { parts, assistant } = input

  const userText = parts
    .filter((p) => p.type === "text" && !p.synthetic && p.messageID === input.message.id)
    .map((p) => (p.type === "text" ? p.text : ""))
    .map(cleanSummary)
    .find((t) => t.length > 0)

  if (userText) return userText

  if (assistant && assistant.length > 0) {
    const running = assistant.some(isRunning)
    if (running) return "正在回复…"
    const error = assistant.find((m) => m.error && m.error.name !== "MessageAbortedError")
    if (error) return error.error?.name ?? "回复出错"
  }

  return ""
}

export function cleanSummary(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~#]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Capitalizes an agent identifier for display, matching the official
 * timeline's agent header convention (`fae` → `Fae`).
 */
export function agentDisplayName(agent: string): string {
  if (!agent) return ""
  return agent[0]!.toUpperCase() + agent.slice(1)
}

/**
 * Formats a completed turn duration as compact seconds/minutes (`45s`,
 * `2m 13s`). Negative or non-finite inputs produce an empty string.
 */
export function formatTurnDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ""
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

/**
 * A bounded, in-memory map for transient expansion state. Only user-selected
 * overrides are stored; the map evicts the oldest entry when it exceeds its
 * limit. Session data, WorkbenchStore and localStorage never carry this state.
 */
export function createBoundedExpansionState(limit: number) {
  const map = new Map<string, boolean>()

  const key = (sessionID: string, tool: string, callID: string) => `${sessionID}\n${tool}\n${callID}`

  return {
    get(sessionID: string, tool: string, callID: string): boolean | undefined {
      return map.get(key(sessionID, tool, callID))
    },
    set(sessionID: string, tool: string, callID: string, value: boolean) {
      const k = key(sessionID, tool, callID)
      if (map.has(k)) map.delete(k)
      map.set(k, value)
      while (map.size > limit) {
        const first = map.keys().next().value
        if (first === undefined) break
        map.delete(first)
      }
    },
  }
}
