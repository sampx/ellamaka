import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { createEffect, createMemo, Match, on, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { FileSearchHandle } from "@opencode-ai/ui/file"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { makeEventListener } from "@solid-primitives/event-listener"
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { FileProvider, useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { WorkbenchPanelDirectoryProvider } from "../workbench-directory-provider"
import {
  createFileScroller,
  fileViewerRoute,
  resolveFileViewerState,
  type FileScroller,
  type FileScrollPos,
} from "./file-viewer-adapter"

/**
 * Workbench file viewer panel (read-only).
 *
 * Renders a single file with the shared `FileComponent` in text mode, syncing
 * the scroll position through the pure `FileScroller` adapter (backed by
 * `useFile`). Inline line comments are intentionally not wired up yet — see the
 * Task 2 trade-off note in the plan. The v2 header owns the close affordance.
 */

type FileViewerInnerProps = {
  filePath: string
  name: string
}

function FileViewerInner(props: FileViewerInnerProps) {
  const file = useFile()
  const language = useLanguage()
  const fileComponent = useFileComponent()

  let find: FileSearchHandle | null = null
  const search = {
    register: (handle: FileSearchHandle | null) => {
      find = handle
    },
  }

  const path = () => props.filePath
  const state = createMemo(() => file.get(path()))
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))
  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    if (!file.ready()) return null
    const value = file.selectedLines(path())
    if (typeof value !== "object" || value === null) return null
    const start = (value as { start?: unknown }).start
    const end = (value as { end?: unknown }).end
    if (typeof start !== "number" || typeof end !== "number") return null
    return { start, end } satisfies SelectedLineRange
  })

  // Scroll sync backed by the pure FileScroller adapter over useFile primitives.
  const scroller: FileScroller = createFileScroller({
    scrollTop: (key) => file.scrollTop(key),
    scrollLeft: (key) => file.scrollLeft(key),
    setScrollTop: (key, top) => file.setScrollTop(key, top),
    setScrollLeft: (key, left) => file.setScrollLeft(key, left),
  })

  let viewport: HTMLDivElement | undefined
  let pending: FileScrollPos | undefined
  let scrollFrame: number | undefined
  let restoreFrame: number | undefined

  const save = (next: FileScrollPos) => {
    pending = next
    if (scrollFrame !== undefined) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined
      const out = pending
      pending = undefined
      if (!out) return
      scroller.setScroll(path(), out)
    })
  }

  /** Best-effort horizontal code container lookup for x-scroll sync. */
  const codeContainer = (): HTMLElement | undefined => {
    const el = viewport
    if (!el) return undefined
    const host = el.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return undefined
    const root = host.shadowRoot
    if (!root) return undefined
    return (
      Array.from(root.querySelectorAll("[data-code]")).find(
        (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
      ) ?? undefined
    )
  }

  const restore = () => {
    const el = viewport
    if (!el) return
    const pos = scroller.scroll(path())
    if (!pos) return
    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    const code = codeContainer()
    if (code && code.scrollLeft !== pos.x) code.scrollLeft = pos.x
    else if (!code && el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const queueRestore = () => {
    if (restoreFrame !== undefined) return
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = undefined
      restore()
    })
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    const el = event.currentTarget
    const code = codeContainer()
    save(code ? { x: code.scrollLeft, y: el.scrollTop } : { x: el.scrollLeft, y: el.scrollTop })
  }

  const setViewport = (el: HTMLDivElement) => {
    viewport = el
    restore()
  }

  createEffect(
    on(
      path,
      () => {
        void file.load(path())
      },
    ),
  )

  createEffect(() => {
    if (state()?.loaded && file.ready()) queueRestore()
  })

  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "f") return
      event.preventDefault()
      event.stopPropagation()
      find?.focus()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  const viewState = () =>
    resolveFileViewerState({
      loaded: state()?.loaded,
      loading: state()?.loading,
      error: state()?.error,
    })

  const renderFile = (source: string) => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: props.name,
          contents: source,
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        enableHoverUtility
        selectedLines={selectedLines()}
        commentedLines={[]}
        onRendered={queueRestore}
        onLineSelected={(range: SelectedLineRange | null) => {
          file.setSelectedLines(path(), range)
        }}
        search={search}
        class="select-text"
        media={{
          mode: "auto",
          path: path(),
          current: state()?.content,
          onLoad: queueRestore,
        }}
      />
    </div>
  )

  return (
    <ScrollView class="h-full" viewportRef={setViewport} onScroll={handleScroll}>
      <Switch>
        <Match when={viewState() === "loaded"}>{renderFile(contents())}</Match>
        <Match when={viewState() === "loading"}>
          <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
        </Match>
        <Match when={viewState() === "error"}>
          <div class="px-6 py-4 text-text-weak">{state()?.error}</div>
        </Match>
        <Match when={viewState() === "empty"}>
          <div class="px-6 py-4 text-text-weak">{language.t("session.files.empty")}</div>
        </Match>
      </Switch>
    </ScrollView>
  )
}

export function FileViewerPanel(props: {
  directory: string
  filePath: string
  name?: string
  onClose: () => void
}) {
  const route = createMemo(() => fileViewerRoute(props.directory, props.filePath))
  const language = useLanguage()

  return (
    <WorkbenchPanelDirectoryProvider panelID={route().key} directory={props.directory}>
      {() => (
        <FileProvider>
          <div class="flex flex-col h-full min-h-0 bg-v2-background-bg-base border-l border-v2-border-border-base">
            <header class="flex h-7 shrink-0 items-center justify-between px-3 border-b border-v2-border-border-base bg-v2-background-bg-base">
              <span class="text-11-medium text-v2-text-text-strong truncate">{props.name ?? props.filePath}</span>
              <IconButtonV2
                variant="ghost-muted"
                size="small"
                class="size-5 flex items-center justify-center p-0 shrink-0"
                icon={
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                }
                aria-label={language.t("workbench.fileViewer.close")}
                title={language.t("workbench.fileViewer.close")}
                onClick={props.onClose}
              />
            </header>
            <div class="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
              <FileViewerInner filePath={props.filePath} name={props.name ?? props.filePath} />
            </div>
          </div>
        </FileProvider>
      )}
    </WorkbenchPanelDirectoryProvider>
  )
}
