import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Component } from "solid-js"
import type { AssistantMessage, Part, SessionStatus, ToolPart, UserMessage } from "@opencode-ai/sdk/v2"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useSync } from "@/context/sync"
import { createRowStabilizer, projectTranscript, type TranscriptRow } from "./chat-transcript"
import {
  ChatTurnFrame,
  CompactionDivider,
  InteractionBlock,
  NarrativeBlock,
  ReasoningBlock,
  RetryOutcome,
  TurnChangeSummary,
  TurnOutcome,
  UnknownPartBlock,
  UserMessageBlock,
  type ChatUserActionLabels,
  type ChatUserActions,
} from "./chat-blocks"
import {
  ContextToolBlock,
  FileChangeBlock,
  GenericToolBlock,
  ShellActivityBlock,
  SubagentActivityBlock,
  type OpenCodeEditRendererProps,
} from "./chat-tool-blocks"
import { classifyPart } from "./chat-render.utils"
import { PromptNavigator } from "./prompt-navigator"

/**
 * Scroll port shared with PanelChat. It carries the auto-scroll user intent and
 * the current scroll state so the timeline can pause bottom-following when the
 * user scrolls up, selects text or focuses a tool block.
 */
export type MessageTimelineScrollPort = {
  overflow: boolean
  bottom: boolean
  jump: boolean
}

export type WorkbenchChatTimelineProps = {
  sessionID: string
  userMessages: UserMessage[]
  historyShift: boolean
  historyMore: boolean
  historyLoading: boolean
  loadOlder: () => Promise<void>
  scroll: MessageTimelineScrollPort
  showReasoningSummaries: boolean
  shellToolPartsExpanded: boolean
  editToolPartsExpanded: boolean
  showSessionProgressBar: boolean
  editRenderer?: Component<OpenCodeEditRendererProps>
  /** Revert boundary: only messages with id < revert are projected. */
  revert?: string
  /** Test seam: render virtual rows directly instead of through the Virtualizer. */
  virtualize?: boolean
  /** Test seam: capture the Virtualizer handle for scrollToIndex assertions. */
  onVirtualizer?: (handle: VirtualizerHandle | undefined) => void
  /** Test seam: override the active turn derivation (e.g. for scroll tests). */
  activeUserMessageIDOverride?: string
  /** Scroll port callbacks (mirrors the official MessageTimeline contract). */
  setScrollRef?: (el: HTMLDivElement | undefined) => void
  setContentRef?: (el: HTMLDivElement) => void
  onScheduleScrollState?: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll?: () => void
  onMarkScrollGesture?: (target?: EventTarget | null) => void
  hasScrollGesture?: () => boolean
  onUserScroll?: () => void
  onHistoryScroll?: () => void
  onAutoScrollInteraction?: (event: MouseEvent) => void
  shouldAnchorBottom?: () => boolean
  onResumeScroll?: () => void
  onPauseAutoScroll?: () => void
  actions?: ChatUserActions
  actionLabels?: ChatUserActionLabels
  /** Resolves a model display name for the assistant meta footer. */
  modelName?: (providerID: string, modelID: string) => string | undefined
}

const emptyParts: Part[] = []
const idle: SessionStatus = { type: "idle" }

type LiveActivity = {
  label: string
}

function latestAssistant(messages: Array<UserMessage | AssistantMessage>) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === "assistant") return message
  }
}

/**
 * Derives the working-indicator label from the last streamed part. This mirrors
 * Kilo's dedicated transcript-tail status: tool rows keep their own state, and
 * the tail simultaneously explains what the agent is doing next.
 */
function deriveLiveActivity(
  currentStatus: SessionStatus,
  currentMessages: Array<UserMessage | AssistantMessage>,
  getParts: (messageID: string) => Part[],
): LiveActivity | undefined {
  if (currentStatus.type === "idle") return
  if (currentStatus.type === "retry") {
    return { label: `正在重试（第 ${currentStatus.attempt} 次）` }
  }

  const latestMessage = currentMessages.at(-1)
  const assistant = latestMessage?.role === "assistant" ? latestMessage : undefined
  if (!assistant) return { label: "正在思考" }

  const parts = getParts(assistant.id)
  const last = parts.at(-1)
  if (!last) return { label: "正在思考" }

  if (last.type === "tool") {
    if (last.state.status !== "pending" && last.state.status !== "running") {
      return { label: "正在考虑下一步" }
    }
    const tool = last.tool.toLowerCase()
    if (tool === "task") return { label: "正在委派工作" }
    if (tool === "todowrite" || tool === "todoread") return { label: "正在规划下一步" }
    if (tool === "read") return { label: "正在读取上下文" }
    if (tool === "list" || tool === "grep" || tool === "glob") return { label: "正在搜索代码库" }
    if (tool === "webfetch" || tool === "websearch") return { label: "正在搜索网页" }
    if (tool === "edit" || tool === "write" || tool === "apply_patch" || tool === "patch") {
      return { label: "正在编辑文件" }
    }
    if (tool === "bash" || tool === "shell") return { label: "正在运行命令" }
    return { label: "正在执行工具" }
  }

  if (last.type === "reasoning") {
    return { label: last.time.end === undefined ? "正在思考" : "正在考虑下一步" }
  }

  if (last.type === "text") {
    return { label: last.time?.end === undefined ? "正在组织回复" : "正在考虑下一步" }
  }

  return { label: "正在考虑下一步" }
}

function formatElapsed(start: number, current: number) {
  const seconds = Math.max(0, Math.floor((current - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function ToolPartBlock(props: {
  part: ToolPart
  message: AssistantMessage
  shellToolPartsExpanded: boolean
  editToolPartsExpanded: boolean
  editRenderer?: Component<OpenCodeEditRendererProps>
  onSyncChild?: (childID: string) => void
}) {
  const kind = createMemo(() => classifyPart(props.part, props.message).kind)
  return (
    <Show
      when={kind() === "context"}
      fallback={
        <Show
          when={kind() === "shell"}
          fallback={
            <Show
              when={kind() === "file-change"}
              fallback={
                <Show
                  when={kind() === "subagent"}
                  fallback={
                    <Show when={kind() === "interaction"} fallback={<GenericToolBlock part={props.part} message={props.message} defaultOpen={props.shellToolPartsExpanded} />}>
                      <InteractionBlock part={props.part} message={props.message} />
                    </Show>
                  }
                >
                  <SubagentActivityBlock part={props.part} message={props.message} onSyncChild={props.onSyncChild} />
                </Show>
              }
            >
              <FileChangeBlock
                part={props.part}
                message={props.message}
                defaultOpen={props.editToolPartsExpanded}
                editRenderer={props.editRenderer}
              />
            </Show>
          }
        >
          <ShellActivityBlock
            part={props.part}
            message={props.message}
            defaultOpen={props.shellToolPartsExpanded}
          />
        </Show>
      }
    >
      <ContextToolBlock part={props.part} message={props.message} defaultOpen={props.shellToolPartsExpanded} />
    </Show>
  )
}

function AssistantPartBlock(props: {
  part: Part
  message: AssistantMessage
  showMeta?: boolean
  showReasoningSummaries?: boolean
  modelName?: (providerID: string, modelID: string) => string | undefined
}) {
  const kind = createMemo(() => classifyPart(props.part, props.message).kind)
  return (
    <Show
      when={kind() === "narrative"}
      fallback={
        <Show
          when={kind() === "reasoning"}
          fallback={
            <Show
              when={kind() === "compaction"}
              fallback={
                <Show
                  when={kind() === "retry"}
                  fallback={
                    <Show
                      when={kind() === "interaction"}
                      fallback={<UnknownPartBlock part={props.part} />}
                    >
                      <InteractionBlock part={props.part} message={props.message} />
                    </Show>
                  }
                >
                  <RetryOutcome part={props.part} />
                </Show>
              }
            >
              <CompactionDivider part={props.part} />
            </Show>
          }
        >
          <ReasoningBlock part={props.part} message={props.message} defaultOpen={props.showReasoningSummaries} />
        </Show>
      }
    >
      <NarrativeBlock part={props.part} message={props.message} showMeta={props.showMeta} modelName={props.modelName} />
    </Show>
  )
}

/**
 * TranscriptRowView renders a single transcript row. User rows render the user
 * bubble; assistant rows render the agent response part stream; diff and error
 * rows render their summaries. All rows share the ChatTurnFrame boundary.
 */
function TranscriptRowView(props: {
  row: TranscriptRow
  getParts: (id: string) => Part[]
  activeUserMessageID?: string | { current: () => string | undefined }
  shellToolPartsExpanded: boolean
  editToolPartsExpanded: boolean
  editRenderer?: Component<OpenCodeEditRendererProps>
  actions?: ChatUserActions
  actionLabels?: ChatUserActionLabels
  onSyncChild?: (childID: string) => void
  modelName?: (providerID: string, modelID: string) => string | undefined
  showReasoningSummaries: boolean
}) {
  const row = () => props.row
  const activeUserMessageID = () => {
    const active = props.activeUserMessageID
    return typeof active === "object" ? active.current() : active
  }
  const metaPartID = createMemo(() => {
    const r = row()
    if (r.type !== "assistant") return undefined
    return (r as Extract<TranscriptRow, { type: "assistant" }>).metaPartID
  })
  return (
    <ChatTurnFrame turnID={row().turnID}>
      <div
        data-row-key={row().key}
        data-row-type={row().type}
        data-turn-id={row().turnID}
        data-active={row().turnID === activeUserMessageID()}
      >
        <Show when={row().type === "user"}>
          <UserMessageBlock
            message={row().message as UserMessage}
            parts={(row() as Extract<TranscriptRow, { type: "user" }>).parts}
            actions={props.actions}
            actionLabels={props.actionLabels}
          />
        </Show>
        <Show when={row().type === "assistant"}>
          <For each={(row() as Extract<TranscriptRow, { type: "assistant" }>).parts}>
            {(part) => (
              <Show when={part.type === "tool"} fallback={<AssistantPartBlock part={part} message={row().message as AssistantMessage} showMeta={part.id === metaPartID()} showReasoningSummaries={props.showReasoningSummaries} modelName={props.modelName} />}>
                <ToolPartBlock
                  part={part as ToolPart}
                  message={row().message as AssistantMessage}
                  shellToolPartsExpanded={props.shellToolPartsExpanded}
                  editToolPartsExpanded={props.editToolPartsExpanded}
                  editRenderer={props.editRenderer}
                  onSyncChild={props.onSyncChild}
                />
              </Show>
            )}
          </For>
        </Show>
        <Show when={row().type === "diff"}>
          <TurnChangeSummary message={row().message as UserMessage} />
        </Show>
        <Show when={row().type === "error"}>
          <TurnOutcome message={row().message as AssistantMessage} />
        </Show>
      </div>
    </ChatTurnFrame>
  )
}

/**
 * VirtualHistory renders the stable, completed transcript rows inside the
 * Virtualizer. It only receives stable rows so high-frequency text deltas never
 * change virtual row measurements.
 */
function VirtualHistory(props: {
  rows: TranscriptRow[]
  getParts: (id: string) => Part[]
  historyShift: boolean
  scrollRef: HTMLDivElement
  virtualize?: boolean
  onVirtualizer?: (handle: VirtualizerHandle | undefined) => void
  activeUserMessageID?: string | { current: () => string | undefined }
  shellToolPartsExpanded: boolean
  editToolPartsExpanded: boolean
  editRenderer?: Component<OpenCodeEditRendererProps>
  actions?: ChatUserActions
  actionLabels?: ChatUserActionLabels
  onSyncChild?: (childID: string) => void
  modelName?: (providerID: string, modelID: string) => string | undefined
  showReasoningSummaries: boolean
}) {
  if (props.virtualize === false) {
    // Provide a stub handle so the seam is testable without a real Virtualizer.
    props.onVirtualizer?.({
      scrollToIndex: () => {},
    } as unknown as VirtualizerHandle)
    return (
      <div data-component="chat-virtual-history">
        <For each={props.rows}>
          {(row) => (
            <TranscriptRowView
              row={row}
              getParts={props.getParts}
              activeUserMessageID={props.activeUserMessageID}
              shellToolPartsExpanded={props.shellToolPartsExpanded}
              editToolPartsExpanded={props.editToolPartsExpanded}
              editRenderer={props.editRenderer}
              actions={props.actions}
              actionLabels={props.actionLabels}
              onSyncChild={props.onSyncChild}
              modelName={props.modelName}
              showReasoningSummaries={props.showReasoningSummaries}
            />
          )}
        </For>
      </div>
    )
  }
  return (
    <div data-component="chat-virtual-history">
      <Virtualizer
        data={props.rows}
        itemSize={60}
        scrollRef={props.scrollRef}
        shift={props.historyShift}
        ref={props.onVirtualizer}
      >
        {(row) => (
          <TranscriptRowView
            row={row}
            getParts={props.getParts}
            activeUserMessageID={props.activeUserMessageID}
            shellToolPartsExpanded={props.shellToolPartsExpanded}
            editToolPartsExpanded={props.editToolPartsExpanded}
            editRenderer={props.editRenderer}
            actions={props.actions}
            actionLabels={props.actionLabels}
            onSyncChild={props.onSyncChild}
            modelName={props.modelName}
            showReasoningSummaries={props.showReasoningSummaries}
          />
        )}
      </Virtualizer>
    </div>
  )
}

/**
 * LiveTranscriptTail renders the still-growing assistant segment of the running
 * turn directly, outside the Virtualizer, so streaming deltas never cause
 * measurement jumps.
 */
function LiveTranscriptTail(props: {
  rows: TranscriptRow[]
  getParts: (id: string) => Part[]
  activeUserMessageID?: string | { current: () => string | undefined }
  shellToolPartsExpanded: boolean
  editToolPartsExpanded: boolean
  editRenderer?: Component<OpenCodeEditRendererProps>
  actions?: ChatUserActions
  actionLabels?: ChatUserActionLabels
  onSyncChild?: (childID: string) => void
  modelName?: (providerID: string, modelID: string) => string | undefined
  showReasoningSummaries: boolean
}) {
  return (
    <div data-component="chat-live-tail">
        <For each={props.rows}>
        {(row) => (
          <TranscriptRowView
            row={row}
            getParts={props.getParts}
            activeUserMessageID={props.activeUserMessageID}
            shellToolPartsExpanded={props.shellToolPartsExpanded}
            editToolPartsExpanded={props.editToolPartsExpanded}
            editRenderer={props.editRenderer}
            actions={props.actions}
            actionLabels={props.actionLabels}
            onSyncChild={props.onSyncChild}
            modelName={props.modelName}
            showReasoningSummaries={props.showReasoningSummaries}
          />
        )}
      </For>
    </div>
  )
}

/**
 * WorkbenchChatTimeline is the Workbench-specific chat transcript. It reads the
 * current directory SDK projection and partitions the transcript into a stable
 * virtual history and a directly rendered live tail. It does not import the
 * Workbench Store, Panel ID or Space identity.
 */
export function WorkbenchChatTimeline(props: WorkbenchChatTimelineProps) {
  const sync = useSync()

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const getParts = (messageID: string) => sync.data.part[messageID] ?? emptyParts
  const status = createMemo(() => sync.data.session_status[props.sessionID] ?? idle)
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (status().type === "idle") return
    setNow(Date.now())
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => window.clearInterval(clock))
  })

  const assistantByParent = createMemo(() => {
    const result = new Map<string, AssistantMessage[]>()
    for (const message of messages()) {
      if (message.role !== "assistant") continue
      const list = result.get(message.parentID)
      if (list) {
        list.push(message)
        continue
      }
      result.set(message.parentID, [message])
    }
    return Object.fromEntries(result)
  })

  const stabilize = createRowStabilizer()
  const projection = createMemo(() =>
    projectTranscript({
      messages: messages(),
      getParts,
      status: status(),
      live: props.scroll.bottom,
      revert: props.revert,
      showReasoningSummaries: props.showReasoningSummaries,
      stabilize,
    }),
  )

  const virtualRows = createMemo(() => projection().partition.virtual)
  const directRows = createMemo(() => projection().partition.direct)
  const liveActivity = createMemo(() => deriveLiveActivity(status(), messages(), getParts))
  const busyTurnStartedAt = createMemo(() => {
    const current = messages()
    for (let index = current.length - 1; index >= 0; index--) {
      const message = current[index]
      if (message?.role === "user") return message.time.created
    }
    return latestAssistant(current)?.time.created ?? now()
  })

  const visibleUserMessages = createMemo(() =>
    props.revert ? props.userMessages.filter((m) => m.id < props.revert!) : props.userMessages,
  )

  const [scroller, setScroller] = createSignal<HTMLDivElement>()
  const [scrollTop, setScrollTop] = createSignal(0)
  let virtualizer: VirtualizerHandle | undefined

  // Derive the active turn from the current viewport anchor. Prefer the
  // Virtualizer's findItemIndex(viewport scrollTop); fall back to a row-height
  // estimate when the Virtualizer is not available (e.g. test seam).
  const activeUserMessageID = createMemo(() => {
    if (props.activeUserMessageIDOverride) return props.activeUserMessageIDOverride
    const rows = virtualRows()
    if (rows.length === 0) return visibleUserMessages()[0]?.id
    const viewportOffset = scrollTop()
    let candidateIndex = 0
    if (virtualizer && typeof virtualizer.findItemIndex === "function") {
      candidateIndex = virtualizer.findItemIndex(viewportOffset)
    } else {
      candidateIndex = Math.floor(viewportOffset / 60)
    }
    // A revert can shrink `rows` before Virtua refreshes its internal item
    // count. Clamp the transient stale index to the current projection so the
    // active-turn lookup never dereferences a row that has already disappeared.
    const anchorIndex = Math.min(rows.length - 1, Math.max(0, Number.isFinite(candidateIndex) ? candidateIndex : 0))
    // Walk back to the nearest user row at or above the anchor.
    for (let i = anchorIndex; i >= 0; i--) {
      if (rows[i].type === "user") return rows[i].turnID
    }
    return visibleUserMessages()[0]?.id
  })

  const bindScroller = (el: HTMLDivElement | undefined) => {
    setScroller(el)
    props.setScrollRef?.(el)
  }

  const handleScroll = () => {
    const el = scroller()
    if (!el) return
    setScrollTop(el.scrollTop)
    // `on*` props are stored as functions by SolidJS; non-`on` function props
    // (hasScrollGesture, loadOlder) are auto-invoked as getters.
    props.onScheduleScrollState?.(el)
    props.onHistoryScroll?.()
    const gesture = props.hasScrollGesture as unknown
    if (typeof gesture === "function" ? gesture() : gesture) {
      props.onUserScroll?.()
      props.onAutoScrollHandleScroll?.()
      props.onMarkScrollGesture?.(el)
    }
    if (el.scrollTop < 200 && props.historyMore && !props.historyLoading) {
      const task = props.loadOlder
      if (typeof task === "function") void task()
    }
  }

  const jumpToPrompt = (userMessageID: string) => {
    // Pause auto-scroll so the jump is not overridden by bottom-following.
    props.onPauseAutoScroll?.()
    const index = virtualRows().findIndex((row) => row.turnID === userMessageID)
    if (index !== -1 && virtualizer) {
      virtualizer.scrollToIndex(index, { align: "start" })
      // Virtua mounts rows asynchronously after the scroll; give it one frame
      // before checking the DOM anchor so the first click lands too.
      requestAnimationFrame(() => {
        const anchor = document.querySelector(`[data-turn-id="${userMessageID}"]`)
        anchor?.scrollIntoView({ block: "start" })
      })
      return
    }
    // Fall back to the live tail DOM anchor.
    const anchor = document.querySelector(`[data-turn-id="${userMessageID}"]`)
    anchor?.scrollIntoView({ block: "start" })
  }

  const syncChild = (childID: string) => {
    void sync.session.sync(childID)
  }

  return (
    <div data-component="chat-timeline" style="display:flex; position:relative; height:100%; min-width:0; isolation:isolate;">
      <Show when={props.showSessionProgressBar && status().type !== "idle"}>
        <div data-component="session-progress" data-state="showing" aria-hidden="true">
          <div
            data-component="session-progress-bar"
            style={{
              background: "var(--icon-interactive-base)",
              animation: "session-progress-whip 900ms infinite",
            }}
          />
        </div>
      </Show>
      <PromptNavigator
        sessionID={props.sessionID}
        userMessages={visibleUserMessages()}
        historyMore={props.historyMore}
        historyLoading={props.historyLoading}
        loadOlder={props.loadOlder}
        onJump={jumpToPrompt}
        getParts={getParts}
        assistantByParent={assistantByParent()}
        activeUserMessageID={{ current: activeUserMessageID }}
      />
      <Show when={props.scroll.overflow && props.scroll.jump}>
        <div data-component="chat-resume-scroll">
          <button type="button" data-action="chat-resume-scroll" aria-label="Scroll to bottom" on:click={() => props.onResumeScroll?.()}>
            <Icon name="arrow-down-to-line" size="small" />
          </button>
        </div>
      </Show>
      <div
        data-component="chat-scroller"
        ref={bindScroller}
        onScroll={handleScroll}
        on:click={(event) => props.onAutoScrollInteraction?.(event)}
        style="flex:1; height:100%; overflow:auto; min-width:0;"
      >
        <div data-component="chat-content" ref={(el) => props.setContentRef?.(el)}>
          <Show when={virtualRows().length > 0 && (props.virtualize === false || scroller())}>
            <VirtualHistory
              rows={virtualRows()}
              getParts={getParts}
              historyShift={props.historyShift}
              scrollRef={scroller()!}
              virtualize={props.virtualize}
              activeUserMessageID={{ current: activeUserMessageID }}
              shellToolPartsExpanded={props.shellToolPartsExpanded}
              editToolPartsExpanded={props.editToolPartsExpanded}
              editRenderer={props.editRenderer}
              actions={props.actions}
              actionLabels={props.actionLabels}
              onVirtualizer={(handle) => {
                virtualizer = handle
                props.onVirtualizer?.(handle)
              }}
              onSyncChild={syncChild}
              modelName={props.modelName}
              showReasoningSummaries={props.showReasoningSummaries}
            />
          </Show>
          <Show when={directRows().length > 0}>
            <LiveTranscriptTail
              rows={directRows()}
              getParts={getParts}
              activeUserMessageID={{ current: activeUserMessageID }}
              shellToolPartsExpanded={props.shellToolPartsExpanded}
              editToolPartsExpanded={props.editToolPartsExpanded}
              editRenderer={props.editRenderer}
              actions={props.actions}
              actionLabels={props.actionLabels}
              onSyncChild={syncChild}
              modelName={props.modelName}
              showReasoningSummaries={props.showReasoningSummaries}
            />
          </Show>
          <div data-component="chat-live-activity-slot">
            <Show when={liveActivity()}>
              {(activity) => (
                <div data-component="chat-live-activity" role="status" aria-live="polite">
                  <Spinner class="size-3.5 shrink-0 text-v2-icon-icon-accent" />
                  <span data-slot="chat-live-activity-label">{activity().label}</span>
                  <span data-slot="chat-live-activity-elapsed">
                    {formatElapsed(busyTurnStartedAt(), now())}
                  </span>
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
