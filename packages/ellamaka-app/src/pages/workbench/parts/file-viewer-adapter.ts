import { base64Encode } from "@opencode-ai/core/util/encode"

/**
 * Pure helpers for the Workbench file viewer, kept in a standalone module so
 * unit tests can exercise routing, state resolution and scroll sync without
 * pulling the heavy file-component and its context graph into the test bundle.
 *
 * Owner: Workbench file viewer
 * Deletion condition: never (lives with the viewer)
 */

/**
 * Stable router identity for a file viewer session, mirroring panelChatRoute:
 * the directory and file path are base64-encoded into a route that supplies the
 * `dir` / `id` params consumed by FileProvider / CommentsProvider / PromptProvider.
 * `key` changes whenever the directory or file changes so the viewer remounts
 * cleanly and stale provider state cannot leak between files.
 */
export function fileViewerRoute(directory: string, path: string) {
  const viewPath = `/${base64Encode(directory)}/viewer/${base64Encode(path)}`
  return { key: `${directory}\n${path}`, path: viewPath }
}

export type FileViewerState = "loading" | "error" | "loaded" | "empty"

/**
 * Resolves the single source of truth for what to render in a file viewer.
 * Priority: loaded, then error, then loading, else empty.
 */
export function resolveFileViewerState(input: {
  loaded?: boolean
  loading?: boolean
  error?: string
}): FileViewerState {
  if (input.loaded) return "loaded"
  if (input.error) return "error"
  if (input.loading) return "loading"
  return "empty"
}

export type FileScrollPos = { x: number; y: number }

export type OpenedFileEntry = {
  directory: string
  filePath: string
  name?: string
}

/**
 * Opens a file in the floating viewer's tab list. Clicking an already-open
 * file only activates its tab (no duplicates); a new file is appended and
 * activated.
 */
export function openViewerFile(tabs: OpenedFileEntry[], file: OpenedFileEntry): OpenedFileEntry[] {
  return tabs.some((tab) => tab.filePath === file.filePath && tab.directory === file.directory)
    ? tabs
    : [...tabs, file]
}

/**
 * Removes a tab and resolves which tab becomes active after the close.
 * Closing the active tab activates its right neighbour (or the last tab
 * after removal); closing a background tab keeps the current selection.
 * Returns `undefined` activeKey when no tabs remain.
 */
export function closeViewerTab(
  tabs: OpenedFileEntry[],
  activeKey: string,
  closedKey: string,
): { tabs: OpenedFileEntry[]; activeKey?: string } {
  const keyOf = (tab: OpenedFileEntry) => `${tab.directory}\n${tab.filePath}`
  const closed = tabs.find((tab) => keyOf(tab) === closedKey)
  if (!closed) return { tabs, activeKey }
  const next = tabs.filter((tab) => tab.directory !== closed.directory || tab.filePath !== closed.filePath)
  if (activeKey !== closedKey) return { tabs: next, activeKey }
  const fallbackIndex = Math.min(tabs.indexOf(closed), next.length - 1)
  const fallback = next[fallbackIndex]
  return { tabs: next, activeKey: fallback ? `${fallback.directory}\n${fallback.filePath}` : undefined }
}

/**
 * The read/write scroll interface consumed by the file viewer's scroll sync,
 * matching the `view` shape that createScrollSync expects ({ scroll, setScroll }).
 */
export type FileScroller = {
  scroll: (key: string) => FileScrollPos | undefined
  setScroll: (key: string, pos: FileScrollPos) => void
}

/**
 * Adapts primitive per-axis scroll getters/setters (the shape exposed by
 * `useFile(): scrollTop/scrollLeft/setScrollTop/setScrollLeft`) into the
 * combined { scroll, setScroll } interface, coalescing partial reads and
 * suppressing writes whose value is unchanged. Getters may be typed `unknown`
 * (the `useFile` context returns `unknown`); non-finite values are read as
 * unset.
 */
export function createFileScroller(input: {
  scrollTop: (key: string) => unknown
  scrollLeft: (key: string) => unknown
  setScrollTop: (key: string, top: number) => void
  setScrollLeft: (key: string, left: number) => void
}): FileScroller {
  const readX = (key: string) => {
    const value = input.scrollLeft(key)
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
  }
  const readY = (key: string) => {
    const value = input.scrollTop(key)
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
  }

  return {
    scroll(key) {
      const x = readX(key)
      const y = readY(key)
      if (x === undefined && y === undefined) return undefined
      return { x: x ?? 0, y: y ?? 0 }
    },
    setScroll(key, pos) {
      const currentX = readX(key)
      const currentY = readY(key)
      if (currentX !== pos.x) input.setScrollLeft(key, pos.x)
      if (currentY !== pos.y) input.setScrollTop(key, pos.y)
    },
  }
}
