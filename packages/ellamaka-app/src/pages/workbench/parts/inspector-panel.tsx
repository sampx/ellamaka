import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { Tabs } from "@opencode-ai/ui/tabs"
import { For, Show, createEffect, createMemo, createSignal, Match, on, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { FileSearchHandle } from "@opencode-ai/ui/file"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { makeEventListener } from "@solid-primitives/event-listener"
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { createLineCommentController } from "@opencode-ai/ui/line-comment-annotations"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { FileProvider, useFile, type SelectedLineRange } from "@/context/file"
import type { LineComment } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { WorkbenchPanelDirectoryProvider } from "../workbench-directory-provider"
import { useWorkbenchPromptRegistry } from "../workbench-prompt-registry"
import {
  createFileScroller,
  fileViewerRoute,
  resolveFileViewerState,
  submitFileComment,
  surfaceTabKey,
  type FileScroller,
  type FileScrollPos,
  type OpenedFileEntry,
  type FileSurfaceTab,
  type SurfaceTab,
} from "./inspector-adapter"

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

  // Line comments. The viewer floats outside the chat Panel's provider tree,
  // so comments are projected into the active Panel's prompt/comments through
  // the workbench registry; the local store is the viewer's own projection for
  // rendering and inline editing within this viewer session.
  const registry = useWorkbenchPromptRegistry()
  const [localComments, setLocalComments] = createSignal<LineComment[]>([])
  const fileComments = createMemo(() => {
    const target = registry.activeComments()
    const persisted = target?.list(path()) ?? []
    return [...persisted.filter((c) => c.file === path()), ...localComments()]
  })
  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))
  const [openedComment, setOpenedComment] = createSignal<string | null>(null)
  const [commenting, setCommenting] = createSignal<SelectedLineRange | null>(null)

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const saved = submitFileComment({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
      preview: input.preview,
      origin: input.origin,
      contents: contents(),
      comments: registry.activeComments(),
      prompt: registry.activePrompt(),
    })
    if (saved) setLocalComments((list) => [...list.filter((c) => c.id !== saved.id), saved])
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
  }) => {
    registry.activeComments()?.update(input.file, input.id, input.comment)
    const preview =
      input.file === path()
        ? previewSelectedLines(contents(), { start: input.selection.start, end: input.selection.end })
        : undefined
    registry.activePrompt()?.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(preview ? { preview } : {}),
    })
    setLocalComments((list) =>
      list.map((c) => (c.id === input.id ? { ...c, comment: input.comment } : c)),
    )
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    registry.activeComments()?.remove(input.file, input.id)
    registry.activePrompt()?.context.removeComment(input.file, input.id)
    setLocalComments((list) => list.filter((c) => c.id !== input.id))
  }

  const commentsUi = createLineCommentController({
    comments: fileComments,
    label: language.t("ui.lineComment.submit"),
    draftKey: () => path(),
    state: {
      opened: () => openedComment(),
      setOpened: (id) => setOpenedComment(id),
      selected: () => null,
      setSelected: () => {},
      commenting: () => commenting(),
      setCommenting: (range) => setCommenting(range),
      syncSelected: (range) => {
        const p = path()
        if (!p) return
        file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
      },
      hoverSelected: (range) => {
        const p = path()
        if (!p) return
        file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
      },
    },
    getHoverSelectedRange: () => selectedLines(),
    cancelDraftOnCommentToggle: true,
    clearSelectionOnSelectionEndNull: true,
    onSubmit: ({ comment, selection }) => {
      const p = path()
      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onUpdate: ({ id, comment, selection }) => {
      const p = path()
      if (!p) return
      updateCommentInContext({ id, file: p, selection, comment })
    },
    onDelete: (comment) => {
      const p = path()
      if (!p) return
      removeCommentFromContext({ id: comment.id, file: p })
    },
    editSubmitLabel: language.t("common.save"),
    renderCommentActions: (_, controls) => (
      <div class="flex items-center gap-1">
        <button type="button" class="text-11-medium text-v2-text-text-weak hover:text-v2-text-text-strong px-1" onClick={controls.edit}>
          {language.t("common.edit")}
        </button>
        <button type="button" class="text-11-medium text-v2-text-text-weak hover:text-v2-text-text-danger px-1" onClick={controls.remove}>
          {language.t("common.delete")}
        </button>
      </div>
    ),
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
        commentedLines={commentedLines()}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderHoverUtility={commentsUi.renderHoverUtility}
        onRendered={queueRestore}
        onLineSelected={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineSelectionEnd={commentsUi.onLineSelectionEnd}
        onLineNumberSelectionEnd={commentsUi.onLineNumberSelectionEnd}
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

function FileViewerTabContent(props: { entry: OpenedFileEntry }) {
  const route = createMemo(() => fileViewerRoute(props.entry.directory, props.entry.filePath))

  return (
    <WorkbenchPanelDirectoryProvider panelID={route().key} directory={props.entry.directory}>
      {() => (
        <FileProvider>
          <FileViewerInner
            filePath={props.entry.filePath}
            name={props.entry.name ?? props.entry.filePath}
          />
        </FileProvider>
      )}
    </WorkbenchPanelDirectoryProvider>
  )
}

function isFileTab(tab: SurfaceTab): tab is FileSurfaceTab {
  return tab.kind === "file"
}

/**
 * Renders the content of one surface tab. New tab kinds plug in here: add the
 * kind to `SurfaceTab`, then a Match branch dispatching to its component.
 */
function SurfaceTabContent(props: { tab: SurfaceTab }) {
  const fileTab = createMemo(() => (isFileTab(props.tab) ? props.tab : undefined))
  return (
    <Switch>
      <Match when={fileTab()}>
        {(tab) => <FileViewerTabContent entry={tab()} />}
      </Match>
    </Switch>
  )
}

export function WorkbenchInspector(props: {
  tabs: SurfaceTab[]
  activeKey: string
  onActiveKeyChange: (key: string) => void
  onCloseTab: (key: string) => void
  onClose: () => void
}) {
  const language = useLanguage()
  const [expanded, setExpanded] = createSignal(false)

  return (
    <div
      data-component="workbench-inspector-surface"
      class={`absolute z-40 flex flex-col overflow-hidden border border-v2-border-border-base bg-v2-background-bg-base shadow-[var(--v2-elevation-floating)] ${
        expanded() ? "inset-2" : "top-2 bottom-2 right-2 w-[480px] max-w-[50vw]"
      }`}
    >
      <Tabs value={props.activeKey} onChange={props.onActiveKeyChange} class="flex flex-col h-full min-h-0">
        <div class="flex h-9 shrink-0 items-center border-b border-v2-border-border-base bg-v2-background-bg-base">
          <Show when={props.tabs.length > 0}>
            <Tabs.List class="flex-1 min-w-0 overflow-x-auto">
              <For each={props.tabs}>
                {(tab) => {
                  const key = surfaceTabKey(tab)
                  const fileTab = isFileTab(tab) ? tab : undefined
                  return (
                    <Tabs.Trigger
                      value={key}
                      class="max-w-[180px]"
                      closeButton={
                        <IconButtonV2
                          variant="ghost-muted"
                          size="small"
                          class="size-4 flex items-center justify-center p-0 shrink-0"
                          icon={
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                          }
                          aria-label={language.t("workbench.fileViewer.close")}
                          onClick={() => props.onCloseTab(key)}
                        />
                      }
                    >
                      <span class="text-12-medium truncate">{fileTab?.name ?? fileTab?.filePath ?? tab.kind}</span>
                    </Tabs.Trigger>
                  )
                }}
              </For>
            </Tabs.List>
          </Show>
          <div class="ml-auto flex shrink-0 items-center gap-1 pr-2 pl-2">
            <IconButtonV2
              variant="ghost-muted"
              size="small"
              class="size-5 flex items-center justify-center p-0 shrink-0"
              icon={
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <Show
                    when={expanded()}
                    fallback={<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />}
                  >
                    <path d="M9 3H3v6M15 21h6v-6M3 3l6 6M21 21l-7-7" />
                  </Show>
                </svg>
              }
              aria-label={language.t(expanded() ? "workbench.fileViewer.collapse" : "workbench.fileViewer.expand")}
              title={language.t(expanded() ? "workbench.fileViewer.collapse" : "workbench.fileViewer.expand")}
              onClick={() => setExpanded(!expanded())}
            />
            <IconButtonV2
              variant="ghost-muted"
              size="small"
              class="size-5 flex items-center justify-center p-0 shrink-0"
              icon={
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              }
              aria-label={language.t("workbench.fileViewer.closeAll")}
              title={language.t("workbench.fileViewer.closeAll")}
              onClick={props.onClose}
            />
          </div>
        </div>
        <For each={props.tabs}>
          {(tab) => {
            const key = surfaceTabKey(tab)
            return (
              <Tabs.Content value={key} class="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
                <SurfaceTabContent tab={tab} />
              </Tabs.Content>
            )
          }}
        </For>
      </Tabs>
    </div>
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
