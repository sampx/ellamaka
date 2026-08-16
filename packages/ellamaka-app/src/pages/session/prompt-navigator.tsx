import { createEffect, createMemo, createSignal, For } from "solid-js"
import type { JSX } from "solid-js"
import type { AssistantMessage, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { Icon } from "@opencode-ai/ui/icon"
import { cleanSummary, extractPromptSummary } from "./chat-render.utils"

export type PromptNavigatorProps = {
  sessionID: string
  userMessages: UserMessage[]
  historyMore: boolean
  historyLoading: boolean
  loadOlder: () => Promise<void>
  onJump: (userMessageID: string) => void
  /** Active turn id for directory highlight. */
  /** The viewport-derived active turn; a container preserves reactivity in classic JSX. */
  activeUserMessageID?: string | { current: () => string | undefined }
  /** Optional part accessor for summaries. */
  getParts?: (messageID: string) => Part[]
  /** Optional assistant messages grouped by parent user message. */
  assistantByParent?: Record<string, AssistantMessage[]>
}

/**
 * PromptNavigator is the Ellamaka-native prompt navigation rail. It manages
 * only committed conversation history: each loaded user message gets a tick on
 * the rail and a two-line summary in the directory popover. It never parses SDK
 * data itself; it reads the transcript layer's prompt index and summaries.
 */
export function PromptNavigator(props: PromptNavigatorProps) {
  const [open, setOpen] = createSignal(false)
  const [focusIndex, setFocusIndex] = createSignal(0)
  let navigatorRef: HTMLDivElement | undefined
  let popoverRef: HTMLDivElement | undefined
  let railRef: HTMLDivElement | undefined

  const getParts = (id: string) => props.getParts?.(id) ?? []
  const assistantFor = (id: string) => props.assistantByParent?.[id] ?? []
  const activeUserMessageID = () => {
    const active = props.activeUserMessageID
    return typeof active === "object" ? active.current() : active
  }

  const entries = createMemo(() =>
    props.userMessages.map((message) => {
      const parts = getParts(message.id)
      const assistant = assistantFor(message.id)
      const assistantText = assistant
        .flatMap((a) => getParts(a.id))
        .filter((p) => p.type === "text" && !p.synthetic)
        .map((p) => (p.type === "text" ? p.text : ""))
        .map(cleanSummary)
        .filter((t) => t.trim().length > 0)
        .at(-1)
      return {
        userMessageID: message.id,
        userSummary: extractPromptSummary({ message, parts }),
        assistantSummary: assistantText ?? extractPromptSummary({ message, parts: [], assistant }),
      }
    }),
  )

  const activeIndex = () => {
    const active = navigatorRef?.querySelector<HTMLElement>("[data-slot='chat-prompt-tick'][data-active='true']")?.dataset.messageId ?? activeUserMessageID()
    if (!active) return -1
    return entries().findIndex((e) => e.userMessageID === active)
  }

  const openDirectory = () => {
    setOpen(true)
    setFocusIndex(Math.max(0, activeIndex()))
    // `loadOlder` is `useSessionHistoryLoader.loadAndReveal`, which already
    // serially hydrates pages until historyMore is false or no growth occurs.
    if (props.historyMore && !props.historyLoading) {
      const task = props.loadOlder
      if (typeof task === "function") void task()
    }
  }

  const jump = (id: string) => {
    props.onJump(id)
    setOpen(false)
    setPreview(undefined)
    railRef?.focus()
  }

  const [preview, setPreview] = createSignal<{ id: string; top: number }>()

  const showPreview = (id: string, tick: HTMLElement) => {
    if (open()) return
    setPreview({ id, top: tick.offsetTop })
  }

  const previewEntry = createMemo(() => {
    const current = preview()
    if (!current) return undefined
    return entries().find((e) => e.userMessageID === current.id)
  })

  const jumpByOffset = (offset: number) => {
    const list = entries()
    const current = activeIndex()
    const target = current === -1 ? (offset > 0 ? 0 : list.length - 1) : current + offset
    if (target >= 0 && target < list.length) jump(list[target].userMessageID)
  }

  const handleKeydown = (event: KeyboardEvent) => {
    const list = entries()
    if (list.length === 0) return
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        setFocusIndex((i) => Math.min(i + 1, list.length - 1))
        break
      case "ArrowUp":
        event.preventDefault()
        setFocusIndex((i) => Math.max(i - 1, 0))
        break
      case "Home":
        event.preventDefault()
        setFocusIndex(0)
        break
      case "End":
        event.preventDefault()
        setFocusIndex(list.length - 1)
        break
      case "Enter": {
        event.preventDefault()
        const item = list[focusIndex()]
        if (item) jump(item.userMessageID)
        break
      }
      case "Escape":
        event.preventDefault()
        setOpen(false)
        railRef?.focus()
        break
    }
  }

  // happy-dom does not flush `Show` conditionals; toggle visibility via a
  // data attribute driven by createEffect so tests can observe the open state.
  createEffect(() => {
    if (!popoverRef) return
    popoverRef.setAttribute("data-open", String(open()))
  })

  return (
    <div
      data-component="chat-prompt-navigator"
      ref={(el) => {
        navigatorRef = el
      }}
    >
      <div
        data-component="chat-prompt-rail"
        ref={(el) => {
          railRef = el
        }}
        data-open={open()}
        on:click={openDirectory}
        role="button"
        aria-label="提示词导航"
        tabindex={0}
      >
        <For each={entries()}>
          {(entry) => (
            <button
              data-slot="chat-prompt-tick"
              data-message-id={entry.userMessageID}
              data-active={entry.userMessageID === activeUserMessageID()}
              on:click={(e) => {
                e.stopPropagation()
                jump(entry.userMessageID)
              }}
              on:mouseenter={(e) => showPreview(entry.userMessageID, e.currentTarget)}
              on:mouseleave={() => setPreview(undefined)}
            />
          )}
        </For>
      </div>
      <div
        data-component="chat-prompt-popover"
        ref={(el) => {
          popoverRef = el
        }}
        data-open={open()}
        on:keydown={handleKeydown}
        role="dialog"
        aria-label="提示词导航"
      >
        <div data-slot="chat-prompt-header">
          <span>提示词导航</span>
          <div data-slot="chat-prompt-nav-buttons">
            <button data-slot="chat-prompt-prev" on:click={() => jumpByOffset(-1)} aria-label="上一条">
              <Icon name="chevron-left" size="small" />
            </button>
            <button data-slot="chat-prompt-next" on:click={() => jumpByOffset(1)} aria-label="下一条">
              <Icon name="chevron-right" size="small" />
            </button>
            <button data-slot="chat-prompt-close" on:click={() => setOpen(false)} aria-label="关闭">
              <Icon name="close" size="small" />
            </button>
          </div>
        </div>
        <div data-slot="chat-prompt-loading" data-loading={props.historyLoading}>
          {props.historyLoading ? "正在加载更早消息…" : ""}
        </div>
        <div data-slot="chat-prompt-list">
          <For each={entries()}>
            {(entry, index) => (
              <button
                data-slot="chat-prompt-item"
                data-message-id={entry.userMessageID}
                data-active={entry.userMessageID === activeUserMessageID()}
                data-focused={index() === focusIndex()}
                on:click={() => jump(entry.userMessageID)}
              >
                <div data-slot="chat-prompt-user">{entry.userSummary || "（空回复）"}</div>
                <div data-slot="chat-prompt-assistant">{entry.assistantSummary || "（无回复）"}</div>
              </button>
            )}
          </For>
        </div>
      </div>
      <div
        data-component="chat-prompt-preview"
        data-open={preview() !== undefined}
        style={{ "--preview-top": `${preview()?.top ?? 0}px` }}
      >
        <div data-slot="chat-prompt-preview-text">{previewEntry()?.userSummary || "（空回复）"}</div>
      </div>
    </div>
  )
}
