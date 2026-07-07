import { createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { MemoryRouter, createMemoryHistory, Route } from "@solidjs/router"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { SDKProvider } from "@/context/sdk"
import { PromptProvider } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { TerminalProvider } from "@/context/terminal"
import { CommentsProvider } from "@/context/comments"
import { MessageTimeline } from "@/pages/session/message-timeline"
import { createSessionComposerState } from "@/pages/session/composer"
import { PanelChatHeader } from "./panel-chat-header"
import { PanelChatComposer } from "./panel-chat-composer"
import type { WorkbenchPanel } from "../view"
import type { Session } from "../session-store"

const emptyUserMessages: any[] = []

function PanelChatInner(props: {
  panel: WorkbenchPanel
  session: Session
  directory: string
}) {
  const composer = createSessionComposerState()
  const autoScroll = createAutoScroll({ working: () => true, overflowAnchor: "dynamic" })

  const [ui, setUi] = createStore({
    scroll: { overflow: false, bottom: true, jump: false },
  })

  let scroller: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  let scrollStateFrame: number | undefined
  let scrollStateTarget: HTMLDivElement | undefined

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

  return (
    <div class="flex flex-col h-full min-h-0 bg-v2-background-bg-deep">
      <PanelChatHeader directory={props.directory} />
      <div class="flex-1 min-h-0 overflow-hidden">
        <MessageTimeline
          scroll={ui.scroll}
          onResumeScroll={resumeScroll}
          setScrollRef={setScrollRef}
          onScheduleScrollState={scheduleScrollState}
          onAutoScrollHandleScroll={autoScroll.handleScroll}
          onMarkScrollGesture={() => {}}
          hasScrollGesture={hasScrollGesture}
          onUserScroll={markUserScroll}
          onHistoryScroll={() => {}}
          onAutoScrollInteraction={autoScroll.handleInteraction}
          shouldAnchorBottom={() => true}
          centered={false}
          setContentRef={setContentRef}
          historyShift={false}
          userMessages={emptyUserMessages}
          anchor={() => "#"}
        />
      </div>
      <PanelChatComposer
        state={composer}
        ready={true}
        directory={props.directory}
        inputRef={(el) => { inputRef = el }}
        setPromptDockRef={(el) => { promptDockRef = el }}
        onSubmit={resumeScroll}
        onResponseSubmit={resumeScroll}
      />
    </div>
  )
}

/**
 * Panel Chat — Chat view container for the workbench panel system.
 *
 * Wraps the official MessageTimeline + SessionComposerRegion in the required
 * provider tree (SDKProvider, PromptProvider, FileProvider, TerminalProvider,
 * CommentsProvider) and a MemoryRouter so that useParams() resolves correctly.
 *
 * Uses v1 old design (centered=false, no newLayoutDesigns).
 */
export function PanelChat(props: {
  panel: WorkbenchPanel
  session: Session
  directory: string
  sdk: any
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
          <SDKProvider directory={props.directory}>
            <PromptProvider>
              <FileProvider>
                <TerminalProvider>
                  <CommentsProvider>
                    <PanelChatInner
                      panel={props.panel}
                      session={props.session}
                      directory={props.directory}
                    />
                  </CommentsProvider>
                </TerminalProvider>
              </FileProvider>
            </PromptProvider>
          </SDKProvider>
        )}
      />
    </MemoryRouter>
  )
}
