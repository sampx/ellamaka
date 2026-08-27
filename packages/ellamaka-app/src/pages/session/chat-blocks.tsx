import { createEffect, createMemo, createSignal, on, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { AssistantMessage, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { Icon } from "@opencode-ai/ui/icon"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { getFilename } from "@opencode-ai/core/util/path"
import { agentColor } from "@/utils/agent"
import { agentDisplayName, formatTurnDuration } from "./chat-render.utils"
import { chatExpansionState } from "./chat-expansion-state"
import { WorkbenchMarkdown } from "./workbench-markdown-renderer"

export type ChatUserActions = {
  fork?: (input: { sessionID: string; messageID: string; target: "current" | "split" }) => Promise<void> | void
  canSplit?: boolean
  revert?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
}

export type ChatUserActionLabels = {
  fork: string
  forkCurrent: string
  forkSplit: string
  revert: string
  copy: string
  copied: string
}

const defaultActionLabels: ChatUserActionLabels = {
  fork: "Fork message",
  forkCurrent: "Fork in current panel",
  forkSplit: "Fork in split panel",
  revert: "Revert message",
  copy: "Copy message",
  copied: "Copied",
}

async function writeClipboard(text: string) {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (!clipboard?.writeText) return false
  return clipboard.writeText(text).then(
    () => true,
    () => false,
  )
}

/**
 * UserMessageBlock renders the user's request bubble. It shows the prompt text
 * and, in SDK order, any file attachments, agent references and subtask
 * summaries that belong to the user input model.
 */
export function UserMessageBlock(props: {
  message: UserMessage
  parts: Part[]
  actions?: ChatUserActions
  actionLabels?: ChatUserActionLabels
}) {
  const text = createMemo(() =>
    props.parts
      .filter((p) => p.type === "text" && !p.synthetic)
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n"),
  )
  const files = createMemo(() => props.parts.filter((p) => p.type === "file"))
  const agents = createMemo(() => props.parts.filter((p) => p.type === "agent"))
  const subtasks = createMemo(() => props.parts.filter((p) => p.type === "subtask"))
  const labels = () => props.actionLabels ?? defaultActionLabels
  const [busy, setBusy] = createSignal(false)
  const [forkOpen, setForkOpen] = createSignal(false)
  const [copied, setCopied] = createSignal(false)

  const run = (action: (() => Promise<void> | void) | undefined) => {
    if (!action || busy()) return
    setBusy(true)
    void Promise.resolve().then(action).finally(() => setBusy(false))
  }

  const fork = (target: "current" | "split") => {
    setForkOpen(false)
    run(() => props.actions?.fork?.({
      sessionID: props.message.sessionID,
      messageID: props.message.id,
      target,
    }))
  }

  const copy = () => {
    if (!text()) return
    void writeClipboard(text()).then((done) => {
      if (!done) return
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div data-component="chat-user-message" data-message-id={props.message.id}>
      <Show when={text()}>
        <div data-slot="chat-user-text">{text()}</div>
      </Show>
      <Show when={files().length > 0}>
        <div data-slot="chat-user-attachments">
          <For each={files()}>
            {(file) => (
              <span data-slot="chat-user-attachment" data-file={file.url}>
                <Icon name="file-tree" size="small" />
                {file.filename ?? getFilename(file.url)}
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={agents().length > 0}>
        <div data-slot="chat-user-agents">
          <For each={agents()}>
            {(agent) => (
              <span data-slot="chat-user-agent" data-agent={agent.name}>
                <Icon name="task" size="small" />
                {agent.name}
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={subtasks().length > 0}>
        <div data-slot="chat-user-subtasks">
          <For each={subtasks()}>
            {(subtask) => (
              <span data-slot="chat-user-subtask" data-agent={subtask.agent}>
                <Icon name="task" size="small" />
                {subtask.description || subtask.prompt}
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={text() || props.actions?.fork || props.actions?.revert}>
        <div data-slot="chat-user-actions">
          <Show when={props.actions?.fork}>
            <div data-component="chat-user-fork">
              <button
                type="button"
                data-action="chat-user-fork"
                aria-label={labels().fork}
                title={labels().fork}
                aria-haspopup="menu"
                aria-expanded={forkOpen()}
                disabled={busy()}
                on:click={() => setForkOpen((open) => !open)}
              >
                <Icon name="fork" size="small" />
              </button>
              <Show when={forkOpen()}>
                <div data-slot="chat-user-fork-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    data-action="chat-user-fork-split"
                    disabled={busy() || props.actions?.canSplit === false}
                    on:click={() => fork("split")}
                  >
                    {labels().forkSplit}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-action="chat-user-fork-current"
                    disabled={busy()}
                    on:click={() => fork("current")}
                  >
                    {labels().forkCurrent}
                  </button>
                </div>
              </Show>
            </div>
          </Show>
          <Show when={props.actions?.revert}>
            <button
              type="button"
              data-action="chat-user-revert"
              aria-label={labels().revert}
              title={labels().revert}
              disabled={busy()}
              on:click={() => run(() => props.actions?.revert?.({
                sessionID: props.message.sessionID,
                messageID: props.message.id,
              }))}
            >
              <Icon name="reset" size="small" />
            </button>
          </Show>
          <Show when={text()}>
            <button
              type="button"
              data-action="chat-user-copy"
              aria-label={copied() ? labels().copied : labels().copy}
              title={copied() ? labels().copied : labels().copy}
              on:click={copy}
            >
              <Icon name={copied() ? "check" : "copy"} size="small" />
            </button>
          </Show>
        </div>
      </Show>
    </div>
  )
}

/**
 * NarrativeBlock renders a `text` part as an unbordered Markdown document block.
 * It is the primary final-answer content of an agent reply. Streaming output
 * goes through the Workbench-owned pipeline so a long final answer never
 * rebuilds the whole document per token. The turn's final completed narrative
 * carries a subtle metadata footer (agent, model, duration) that mirrors the
 * official timeline's message meta line.
 */
export function NarrativeBlock(props: {
  part: Part
  message: AssistantMessage
  showMeta?: boolean
  modelName?: (providerID: string, modelID: string) => string | undefined
}) {
  if (props.part.type !== "text") return null
  const streaming = () => typeof props.message.time.completed !== "number"
  const meta = createMemo(() => {
    if (!props.showMeta || streaming()) return []
    const items: Array<{ type: "agent" | "model" | "duration"; value: string }> = []
    const agent = props.message.agent
    if (agent) items.push({ type: "agent", value: agentDisplayName(agent) })
    const model = props.modelName?.(props.message.providerID, props.message.modelID) ?? props.message.modelID
    if (model) items.push({ type: "model", value: model })
    const completed = props.message.time.completed
    if (typeof completed === "number") {
      const duration = formatTurnDuration(completed - props.message.time.created)
      if (duration) items.push({ type: "duration", value: duration })
    }
    return items
  })
  return (
    <div data-component="chat-narrative" data-part-id={props.part.id}>
      <WorkbenchMarkdown text={props.part.text} cacheKey={props.part.id} streaming={streaming()} />
      <Show when={meta().length > 0}>
        <div data-slot="chat-narrative-meta">
          <For each={meta()}>
            {(item, index) => (
              <>
                <Show when={index() > 0}>
                  <span data-slot="chat-narrative-meta-sep" aria-hidden="true">
                    ·
                  </span>
                </Show>
                <span
                  data-slot={`chat-narrative-meta-${item.type}`}
                  style={
                    item.type === "agent"
                      ? ({ "--chat-agent-color": agentColor(item.value) } as JSX.CSSProperties)
                      : undefined
                  }
                >
                  <Show when={item.type === "agent"}>
                    <span data-slot="chat-narrative-meta-dot" aria-hidden="true" />
                  </Show>
                  {item.value}
                </span>
              </>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

/**
 * ReasoningBlock renders a collapsible thinking block. It stays expanded while
 * the owning assistant message is running. When the reasoning-summaries
 * preference enables `defaultOpen`, a completed thought also stays expanded;
 * otherwise it collapses to a single-line summary. A manual toggle always wins
 * and is remembered across virtual-list remounts.
 */
export function ReasoningBlock(props: { part: Part; message: AssistantMessage; defaultOpen?: boolean }) {
  if (props.part.type !== "reasoning") return null
  const running = () => typeof props.message.time.completed !== "number"
  const stored = () => chatExpansionState.get(props.part.sessionID, "reasoning", props.part.id)
  const [selected, setSelected] = createSignal(stored())
  const open = () => selected() ?? (props.defaultOpen ?? running())
  const setOpen = (next: boolean) => {
    setSelected(next)
    chatExpansionState.set(props.part.sessionID, "reasoning", props.part.id, next)
  }

  // The streaming preview is its own scroll container (height-limited while
  // data-streaming). Follow the latest output unless the user scrolled away;
  // scrolling back near the bottom resumes following.
  let contentEl: HTMLDivElement | undefined
  const [following, setFollowing] = createSignal(true)
  const handleContentScroll = () => {
    const el = contentEl
    if (!el) return
    setFollowing(el.scrollHeight - el.clientHeight - el.scrollTop <= 10)
  }
  const text = createMemo(() => (props.part.type === "reasoning" ? props.part.text : undefined))
  createEffect(
    on(text, () => {
      const el = contentEl
      if (!el || !running() || !following()) return
      el.scrollTop = el.scrollHeight
    }),
  )

  return (
    <div
      data-component="chat-reasoning"
      data-part-id={props.part.id}
      data-streaming={running() ? "" : undefined}
    >
      <Collapsible open={open()} onOpenChange={setOpen}>
        <Collapsible.Trigger data-slot="chat-reasoning-trigger" aria-expanded={open()}>
          <Icon name="brain" size="small" />
          <span data-slot="chat-reasoning-label">思考</span>
        </Collapsible.Trigger>
        <Collapsible.Content
          data-slot="chat-reasoning-content"
          data-scrollable=""
          ref={(el: HTMLDivElement) => (contentEl = el)}
          onScroll={handleContentScroll}
        >
          <div data-slot="chat-reasoning-text">{props.part.text}</div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}

/**
 * TurnChangeSummary renders the file-change summary at the end of a turn. It
 * shows the modified file count and add/delete line stats.
 */
export function TurnChangeSummary(props: { message: UserMessage }) {
  const diffs = createMemo(() => (props.message.summary?.diffs ?? []).filter((d) => typeof d.file === "string"))
  const additions = createMemo(() => diffs().reduce((acc, d) => acc + (d.additions ?? 0), 0))
  const deletions = createMemo(() => diffs().reduce((acc, d) => acc + (d.deletions ?? 0), 0))

  return (
    <Show when={diffs().length > 0}>
      <div data-component="chat-change-summary" data-message-id={props.message.id}>
        <span data-slot="chat-change-files">{diffs().length} 个文件</span>
        <span data-slot="chat-change-additions">+{additions()}</span>
        <span data-slot="chat-change-deletions">-{deletions()}</span>
        <For each={diffs()}>
          {(diff) => <span data-slot="chat-change-file">{getFilename(diff.file)}</span>}
        </For>
      </div>
    </Show>
  )
}

/**
 * TurnOutcome renders an assistant error that cannot be attributed to a
 * specific activity block. It appears at the end of the reply.
 */
export function TurnOutcome(props: { message: AssistantMessage }) {
  const error = createMemo(() => {
    const e = props.message.error
    if (!e) return undefined
    const data = e.data as { message?: unknown } | undefined
    const message = typeof data?.message === "string" ? data.message : ""
    return message || e.name
  })

  return (
    <Show when={error()}>
      <div data-component="chat-outcome" data-message-id={props.message.id}>
        <Icon name="circle-x" size="small" />
        <span data-slot="chat-outcome-error">{error()}</span>
      </div>
    </Show>
  )
}

/**
 * ChatTurnFrame is the visual boundary shared by all transcript rows of one
 * turn. It provides the vertical rhythm that groups a user request with its
 * agent response.
 */
export function ChatTurnFrame(props: { turnID: string; children: JSX.Element }) {
  return (
    <div data-component="chat-turn-frame" data-turn-id={props.turnID}>
      {props.children}
    </div>
  )
}

/**
 * CompactionDivider renders a labeled horizontal divider for context
 * compression boundaries.
 */
export function CompactionDivider(props: { part: Part }) {
  if (props.part.type !== "compaction") return null
  return (
    <div data-component="chat-compaction" data-part-id={props.part.id}>
      <span data-slot="chat-compaction-label">上下文已压缩</span>
    </div>
  )
}

/**
 * RetryOutcome renders a model retry record.
 */
export function RetryOutcome(props: { part: Part }) {
  if (props.part.type !== "retry") return null
  return (
    <div data-component="chat-retry" data-part-id={props.part.id}>
      <Icon name="reset" size="small" />
      <span data-slot="chat-retry-attempt">重试 #{props.part.attempt}</span>
    </div>
  )
}

/**
 * InteractionBlock renders a completed question tool as a read-only summary.
 */
export function InteractionBlock(props: { part: Part; message: AssistantMessage }) {
  if (props.part.type !== "tool" || props.part.tool !== "question") return null
  const state = props.part.state
  const output = state.status === "completed" && typeof state.output === "string" ? state.output : ""
  const input = () => (state.input ?? {}) as Record<string, unknown>
  const question = createMemo(() => {
    const i = input()
    if (typeof i.question === "string" && i.question.trim()) return i.question.trim()
    if (Array.isArray(i.questions)) {
      const first = i.questions[0]
      if (typeof first === "string" && first.trim()) return first.trim()
      if (first && typeof first === "object" && typeof (first as Record<string, unknown>).question === "string") {
        return ((first as Record<string, unknown>).question as string).trim()
      }
    }
    return undefined
  })
  return (
    <div data-component="chat-interaction" data-part-id={props.part.id}>
      <div data-slot="chat-interaction-header">
        <span data-slot="chat-interaction-icon">
          <Icon name="speech-bubble" size="small" />
        </span>
        <span data-slot="chat-interaction-label">问题</span>
        <Show when={question()}>
          <span data-slot="chat-interaction-question">{question()}</span>
        </Show>
      </div>
      <div data-slot="chat-interaction-answer">{output || "问题已回答"}</div>
    </div>
  )
}

/**
 * UnknownPartBlock renders a safe fallback for parts the render layer does not
 * recognize. It shows the part type and a safe text/JSON representation.
 */
export function UnknownPartBlock(props: { part: Part }) {
  const text = createMemo(() => {
    const p = props.part as Part & { text?: unknown }
    if (typeof p.text === "string" && p.text) return p.text
    try {
      return JSON.stringify(props.part)
    } catch {
      return String(props.part)
    }
  })
  return (
    <div data-component="chat-unknown-part" data-part-type={props.part.type}>
      <span data-slot="chat-unknown-type">{props.part.type}</span>
      <pre data-slot="chat-unknown-text">{text()}</pre>
    </div>
  )
}
