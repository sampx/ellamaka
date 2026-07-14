import { createMemo, createEffect, onCleanup, Show, batch, on } from "solid-js"
import { createStore } from "solid-js/store"
import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router"
import type { Message, UserMessage } from "@opencode-ai/sdk/v2/client"
import { useMutation } from "@tanstack/solid-query"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { DataProvider } from "@opencode-ai/ui/context"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { SDKProvider, useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { PromptProvider, usePrompt } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { TerminalProvider } from "@/context/terminal"
import { CommentsProvider } from "@/context/comments"
import { LocalProvider, useLocal } from "@/context/local"
import { useLanguage } from "@/context/language"
import { showToast } from "@opencode-ai/ui/toast"
import { formatServerError } from "@/utils/server-errors"
import { extractPromptFromParts } from "@/utils/prompt"
import { findLast } from "@opencode-ai/core/util/array"
import { MessageTimeline } from "@/pages/session/message-timeline"
import { createSessionComposerState } from "@/pages/session/composer"
import { createSessionHistoryLoader } from "./panel-chat-helpers"
import { syncSessionModel } from "@/pages/session/session-model-helpers"
import { same } from "@/utils/same"
import { PanelChatComposer } from "./panel-chat-composer"
import { WorkbenchChatProvider } from "./workbench-chat-context"
import { useWorkbenchState, type WorkbenchPanel } from "../view-store"
import { useLocalPanelActions } from "@/pages/session/use-local-panel-actions"
import type { Session } from "../session-store"

const emptyUserMessages: UserMessage[] = []

function PanelChatInner(props: {
  panel: WorkbenchPanel
  session: Session
  directory: string
  spacePath: string
  spaceName: string
}) {
  const sync = useSync()
  const sdk = useSDK()
  const prompt = usePrompt()
  const language = useLanguage()
  const wb = useWorkbenchState()
  const local = useLocal()

  const composer = createSessionComposerState()
  const autoScroll = createAutoScroll({ working: () => true, overflowAnchor: "dynamic" })

  useLocalPanelActions({
    sessionID: () => props.session.id,
    navigateMessageByOffset: (offset) => {
      // Not fully implemented here, stub
    },
    setActiveMessage: (message) => {
      // Stub
    },
    focusInput: () => inputRef?.focus(),
    registerAction: (id, execute, disabled) =>
      wb.registerPanelAction(props.panel.id, {
        id,
        execute,
        disabled: typeof disabled === "function" ? disabled : disabled !== undefined ? () => disabled : undefined,
      }),
    unregisterAction: (id) => wb.unregisterPanelAction(props.panel.id, id),
    onForked: (newSessionID) => wb.handleSessionForked(props.spacePath, props.panel.id, newSessionID),
  })

  const [ui, setUi] = createStore({
    scroll: { overflow: false, bottom: true, jump: false },
  })

  let scroller: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  let scrollStateFrame: number | undefined
  let scrollStateTarget: HTMLDivElement | undefined
  let revealMessage = (_id: string) => {}

  const jumpThreshold = (el: HTMLDivElement) => Math.max(400, el.clientHeight)

  const updateScrollState = (el: HTMLDivElement) => {
    const max = el.scrollHeight - el.clientHeight
    const distance = max - el.scrollTop
    const overflow = max > 1
    const bottom = !overflow || distance <= 2
    const jump = overflow && distance > jumpThreshold(el)
    if (ui.scroll.overflow === overflow && ui.scroll.bottom === bottom && ui.scroll.jump === jump) return
    setUi("scroll", { overflow, bottom, jump })
  }

  const scheduleScrollState = (el: HTMLDivElement) => {
    scrollStateTarget = el
    if (scrollStateFrame !== undefined) return
    scrollStateFrame = requestAnimationFrame(() => {
      scrollStateFrame = undefined
      const target = scrollStateTarget
      scrollStateTarget = undefined
      if (!target) return
      updateScrollState(target)
    })
  }

  const resumeScroll = () => {
    autoScroll.forceScrollToBottom()
    const el = scroller
    if (el) scheduleScrollState(el)
  }

  const setScrollRef = (el: HTMLDivElement | undefined) => {
    scroller = el
    autoScroll.scrollRef(el)
    if (!el) return
    scheduleScrollState(el)
  }

  const setContentRef = (el: HTMLDivElement) => {
    content = el
    autoScroll.contentRef(el)
    const root = scroller
    if (root) scheduleScrollState(root)
  }

  let scrollMark = 0
  const markUserScroll = () => { scrollMark += 1 }
  const hasScrollGesture = () => scrollMark > 0

  onCleanup(() => {
    if (scrollStateFrame !== undefined) cancelAnimationFrame(scrollStateFrame)
  })

  let inputRef: HTMLDivElement | undefined
  let promptDockRef: HTMLDivElement | undefined

  const messages = createMemo(() => (sync.data.message[props.session.id] ?? []) as Message[])
  const messagesReady = createMemo(() => sync.data.message[props.session.id] !== undefined)

  const info = createMemo(() => (sync.data.session as any[]).find((item) => item.id === props.session.id))
  const revertMessageID = createMemo(() => info()?.revert?.messageID)

  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )

  const visibleUserMessages = createMemo(
    () => {
      const revert = revertMessageID()
      if (!revert) return userMessages()
      return userMessages().filter((m) => m.id < revert)
    },
    emptyUserMessages,
    { equals: same },
  )

  const lastUserMessage = createMemo(() => findLast(visibleUserMessages(), (m) => m.role === "user"))

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        syncSessionModel(local, msg)
      },
    ),
  )

  const historyMore = () => sync.session.history.more(props.session.id)
  const historyLoading = () => sync.session.history.loading(props.session.id)

  const historyLoader = createSessionHistoryLoader({
    sessionID: () => props.session.id,
    loaded: () => messages().length,
    visibleUserMessages: visibleUserMessages,
    historyMore,
    historyLoading,
    loadMore: (sessionID) => sync.session.history.loadMore(sessionID),
    userScrolled: autoScroll.userScrolled,
    scroller: () => scroller,
  })

  const draft = (id: string) =>
    extractPromptFromParts(sync.data.part[id] ?? [], {
      directory: props.directory,
      attachmentName: language.t("common.attachment"),
    })

  const line = (id: string) => {
    const text = draft(id)
      .map((part) => (part.type === "image" ? `[image:${part.filename}]` : part.content))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(err, language.t),
    })
  }

  const merge = (next: NonNullable<ReturnType<typeof info>>) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === next.id)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = next
      return out
    })

  const roll = (sessionID: string, next: NonNullable<ReturnType<typeof info>>["revert"]) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === sessionID)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = { ...out[idx], revert: next }
      return out
    })

  const busy = (sessionID: string) => sync.data.session_working(sessionID)
  const halt = (sessionID: string) =>
    busy(sessionID) ? sdk.client.session.abort({ sessionID }).catch(() => {}) : Promise.resolve()

  const revertMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; messageID: string }) => {
      const prev = prompt.current().slice()
      const last = info()?.revert
      const value = draft(input.messageID)
      batch(() => {
        roll(input.sessionID, { messageID: input.messageID })
        prompt.set(value)
      })
      await halt(input.sessionID)
        .then(() => sdk.client.session.revert(input))
        .then((result) => {
          if (result.data) merge(result.data)
        })
        .catch((err) => {
          batch(() => {
            roll(input.sessionID, last)
            prompt.set(prev)
          })
          fail(err)
        })
    },
  }))

  const restoreMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      const sessionID = props.session.id
      if (!sessionID) return

      const next = userMessages().find((item) => item.id > id)
      const prev = prompt.current().slice()
      const last = info()?.revert

      batch(() => {
        roll(sessionID, next ? { messageID: next.id } : undefined)
        if (next) {
          prompt.set(draft(next.id))
          return
        }
        prompt.reset()
      })

      const task = !next
        ? halt(sessionID).then(() => sdk.client.session.unrevert({ sessionID }))
        : halt(sessionID).then(() =>
            sdk.client.session.revert({
              sessionID,
              messageID: next.id,
            }),
          )

      await task
        .then((result) => {
          if (result.data) merge(result.data)
        })
        .catch((err) => {
          batch(() => {
            roll(sessionID, last)
            prompt.set(prev)
          })
          fail(err)
        })
    },
  }))

  const reverting = createMemo(() => revertMutation.isPending || restoreMutation.isPending)
  const restoring = createMemo(() => (restoreMutation.isPending ? restoreMutation.variables : undefined))

  const revert = (input: { sessionID: string; messageID: string }) => {
    if (reverting()) return
    return revertMutation.mutateAsync(input)
  }

  const restore = (id: string) => {
    if (!props.session.id || reverting()) return
    return restoreMutation.mutateAsync(id)
  }

  const rolled = createMemo(() => {
    const id = revertMessageID()
    if (!id) return []
    return userMessages()
      .filter((item) => item.id >= id)
      .map((item) => ({ id: item.id, text: line(item.id) }))
  })

  return (
    <div class="flex flex-col h-full min-h-0 bg-v2-background-bg-deep">
      <div class="flex-1 min-h-0 overflow-hidden">
        <Show when={messagesReady()}>
          <MessageTimeline
            scroll={ui.scroll}
            onResumeScroll={resumeScroll}
            setScrollRef={setScrollRef}
            onScheduleScrollState={scheduleScrollState}
            onAutoScrollHandleScroll={autoScroll.handleScroll}
            onMarkScrollGesture={() => {}}
            hasScrollGesture={hasScrollGesture}
            onUserScroll={markUserScroll}
            onHistoryScroll={historyLoader.onScrollerScroll}
            onAutoScrollInteraction={autoScroll.handleInteraction}
            shouldAnchorBottom={() => !autoScroll.userScrolled()}
            centered={false}
            setContentRef={setContentRef}
            historyShift={historyLoader.shift()}
            userMessages={historyLoader.userMessages()}
            anchor={() => "#"}
            setRevealMessage={(fn) => { revealMessage = fn }}
            actions={{ revert }}
          />
        </Show>
      </div>
      <PanelChatComposer
        state={composer}
        ready={messagesReady()}
        directory={props.directory}
        inputRef={(el) => { inputRef = el }}
        setPromptDockRef={(el) => { promptDockRef = el }}
        onSubmit={resumeScroll}
        onResponseSubmit={resumeScroll}
        revert={{
          items: rolled(),
          restoring: restoring(),
          disabled: reverting(),
          onRestore: restore,
        }}
      />
    </div>
  )
}

function PanelChatRoute(props: {
  panel: WorkbenchPanel
  session: Session
  directory: string
  spacePath: string
  spaceName: string
}) {
  return (
    <SDKProvider directory={props.directory}>
      <PanelChatDataProvider session={props.session} directory={props.directory}>
        <TerminalProvider>
          <FileProvider>
            <PromptProvider>
              <CommentsProvider>
                <WorkbenchChatProvider>
                  <PanelChatInner
                    panel={props.panel}
                    session={props.session}
                    directory={props.directory}
                    spacePath={props.spacePath}
                    spaceName={props.spaceName}
                  />
                </WorkbenchChatProvider>
              </CommentsProvider>
            </PromptProvider>
          </FileProvider>
        </TerminalProvider>
      </PanelChatDataProvider>
    </SDKProvider>
  )
}

export function PanelChat(props: {
  panel: WorkbenchPanel
  session: Session
  directory: string
  sdk: any
  spacePath: string
  spaceName: string
}) {
  const dirSlug = createMemo(() => base64Encode(props.directory))
  const history = createMemo(() => {
    const h = createMemoryHistory()
    h.set({ value: `/${dirSlug()}/session/${props.session.id}`, replace: true })
    return h
  })

  return (
    <MemoryRouter history={history()}>
      <Route
        path="/:dir/session/:id"
        component={() => (
          <PanelChatRoute
            panel={props.panel}
            session={props.session}
            directory={props.directory}
            spacePath={props.spacePath}
            spaceName={props.spaceName}
          />
        )}
      />
    </MemoryRouter>
  )
}

function PanelChatDataProvider(props: { session: Session; directory: string; children: any }) {
  const sync = useSync()

  // createResource only fires its fetcher when the returned signal is read.
  // PanelChatInner reads sync.data.message[id], but nothing consumed the
  // resource, so sync.session.sync(id) never ran and messages never loaded.
  // Drive the load explicitly via createEffect keyed on the session id.
  createEffect(() => {
    const id = props.session.id
    if (!id) return
    void sync.session.sync(id)
  })

  return (
    <DataProvider
      data={sync.data as any}
      directory={props.directory}
      onNavigateToSession={() => {}}
      onSessionHref={() => ""}
    >
      <LocalProvider sessionID={props.session.id}>{props.children}</LocalProvider>
    </DataProvider>
  )
}
