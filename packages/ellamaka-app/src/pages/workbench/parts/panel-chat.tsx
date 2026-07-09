import { createMemo, createEffect, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router"
import type { Message, UserMessage } from "@opencode-ai/sdk/v2/client"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { DataProvider } from "@opencode-ai/ui/context"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { SDKProvider } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { PromptProvider } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { TerminalProvider } from "@/context/terminal"
import { CommentsProvider } from "@/context/comments"
import { LocalProvider } from "@/context/local"
import { MessageTimeline } from "@/pages/session/message-timeline"
import { createSessionComposerState } from "@/pages/session/composer"
import { createSessionHistoryLoader } from "./panel-chat-helpers"
import { same } from "@/utils/same"
import { PanelChatComposer } from "./panel-chat-composer"
import { WorkbenchChatProvider } from "./workbench-chat-context"
import { useSessionStore } from "../session-store"
import { useWorkbenchState } from "../view"
import type { WorkbenchPanel } from "../view"
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
  const sessionStore = useSessionStore()
  const wb = useWorkbenchState()

  const composer = createSessionComposerState()
  const autoScroll = createAutoScroll({ working: () => true, overflowAnchor: "dynamic" })

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

  // Sync bridge: watch official sync.data.session for title changes
  createEffect(() => {
    const sessions = sync.data.session as any[]
    const officialSession = sessions?.find((s: any) => s.id === props.session.id)
    if (!officialSession) return
    const local = sessionStore.getSession(props.session.id)
    if (local && officialSession.title && officialSession.title !== local.title) {
      sessionStore.renameSession(props.session.id, officialSession.title)
    }
  })

  // Archive/delete sync: official archiveSession (in MessageTimeline) only
  // mutates the official sync store — it splices the session out of
  // sync.data.session and evicts caches. It does not know about workbench's
  // sessionStore or panel binding, so the panel stays bound and the tree
  // cache stays stale after an archive. Detect the session disappearing from
  // sync.data.session (only after it was present, i.e. session.sync injected
  // it) and clean up the workbench side: drop the local reference, unbind the
  // panel (slotState -> empty, PanelChat unmounts), and trigger a tree refresh
  // so spaceOverview refetches and the archived session vanishes from the tree.
  let wasPresent = false
  let cleanupHandled = false
  createEffect(() => {
    if (cleanupHandled) return
    const sessions = sync.data.session as any[]
    const present = sessions?.some((s: any) => s.id === props.session.id) ?? false
    if (present) {
      wasPresent = true
      return
    }
    if (!wasPresent) return
    cleanupHandled = true
    sessionStore.deleteSession(props.session.id)
    wb.unbindSessionFromPanel(props.spacePath, props.panel.id)
    sessionStore.triggerRefresh()
  })

  let inputRef: HTMLDivElement | undefined
  let promptDockRef: HTMLDivElement | undefined

  const messages = createMemo(() => (sync.data.message[props.session.id] ?? []) as Message[])
  const messagesReady = createMemo(() => sync.data.message[props.session.id] !== undefined)

  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )

  const historyMore = () => sync.session.history.more(props.session.id)
  const historyLoading = () => sync.session.history.loading(props.session.id)

  const historyLoader = createSessionHistoryLoader({
    sessionID: () => props.session.id,
    loaded: () => messages().length,
    visibleUserMessages: userMessages,
    historyMore,
    historyLoading,
    loadMore: (sessionID) => sync.session.history.loadMore(sessionID),
    userScrolled: autoScroll.userScrolled,
    scroller: () => scroller,
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
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}
