import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { Show, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSpaceStore } from "../space-store"
import { useWorkbenchState } from "../view-store"
import { useSessionStore } from "../session-store"
import { WorkbenchSettingsMenu } from "./workbench-settings"
import { SessionTree } from "./session-tree"
import { Persist, persisted } from "@/utils/persist"

const MIN_WIDTH = 200
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 300
const COLLAPSED_WIDTH = 44

export function SpaceRail() {
  const store = useSpaceStore()
  const wb = useWorkbenchState()
  const sessionStore = useSessionStore()
  const language = useLanguage()
  const t = (k: string) => language.t(k)

  const expanded = createMemo(() => wb.display().showSpaceRail)
  const [statusMsg, setStatusMsg] = createSignal("")
  const [confirmDialog, setConfirmDialog] = createSignal(false)
  const [pendingSpace, setPendingSpace] = createSignal<{ name: string; path: string; type?: string } | null>(null)

  const [dontRemindStore, setDontRemindStore] = persisted(
    Persist.global("workbench.suppressTabConfirm", []),
    createStore({ suppress: false }),
  )

  const [widthStore, setWidthStore] = persisted(
    Persist.global("workbench.sidebarWidth", []),
    createStore({ width: DEFAULT_WIDTH }),
  )

  const sidebarWidth = () => (expanded() ? widthStore.width : COLLAPSED_WIDTH)

  let resizing = false
  function startResize(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    resizing = true
    const startX = e.clientX
    const startWidth = widthStore.width

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!resizing) return
      const delta = moveEvent.clientX - startX
      let newWidth = startWidth + delta
      if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH
      if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH
      setWidthStore("width", newWidth)
    }

    const onMouseUp = () => {
      resizing = false
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }

    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

  const hasBoundPanels = createMemo(() => {
    const tab = wb.activeTab()
    if (!tab) return false
    const state = wb.spaceState(tab.path)
    return state?.panels.some((p) => p.slotState === "bound") ?? false
  })

  function handleSpaceClick(space: { name: string; path: string; type?: string }) {
    if (space.name === wb.activeSpaceName) return
    if (hasBoundPanels() && !dontRemindStore.suppress) {
      setPendingSpace(space)
      setConfirmDialog(true)
      return
    }
    wb.openTab(space)
  }

  function confirmSwitch() {
    const space = pendingSpace()
    setConfirmDialog(false)
    setPendingSpace(null)
    if (space) wb.openTab(space)
  }

  function cancelSwitch() {
    setConfirmDialog(false)
    setPendingSpace(null)
  }

  function handleProjectClick(spaceName: string, projectPath: string) {
    const tab = wb.tabs.find((t) => t.name === spaceName)
    if (!tab) return
    const state = wb.spaceState(tab.path)
    if (!state) return
    const emptyPanel = state.panels.find((p) => p.slotState === "empty")
    if (!emptyPanel) {
      showStatus(t("workbench.tree.noEmptyPanel"))
      return
    }
    wb.setPanelDirectory(tab.path, emptyPanel.id, projectPath)
    wb.setActivePanel(tab.path, emptyPanel.id)
  }

  function handleSessionClick(sessionId: string) {
    const session = sessionStore.getSession(sessionId)
    if (!session) return
    const isBound = wb.isSessionBound(sessionId)
    const boundPanelId = wb.boundPanelIdForSession(sessionId)
    if (isBound && boundPanelId) {
      const tab = wb.tabs.find((t) => t.name === session.spaceName)
      if (tab) wb.setActivePanel(tab.path, boundPanelId)
    }
  }

  function showStatus(msg: string) {
    setStatusMsg(msg)
    setTimeout(() => setStatusMsg(""), 3000)
  }

  return (
    <>
      <aside
        classList={{
          "flex shrink-0 flex-col border-r border-v2-border-border-base bg-v2-background-bg-deep": true,
          "items-center": !expanded(),
        }}
        style={{ width: `${sidebarWidth()}px`, transition: resizing ? "none" : "width 0.15s" }}
      >
      <header
        classList={{
          "flex h-7 shrink-0 items-center": true,
          "justify-between px-2": expanded(),
          "justify-center": !expanded(),
        }}
      >
        <Show
          when={expanded()}
          fallback={
            <IconButtonV2
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="sidebar-right" class="rotate-180" />}
              aria-label={t("workbench.sidebar.expand")}
              onClick={() => wb.setDisplay("showSpaceRail", true)}
            />
          }
        >
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <span class="text-10-medium text-v2-text-text-muted uppercase [letter-spacing:1.5px]">
              {t("workbench.sidebar.spaces")}
            </span>
          </div>
          <div class="flex items-center gap-0.5">
            <IconButtonV2
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="sidebar-right" />}
              aria-label={t("workbench.sidebar.collapse")}
              onClick={() => wb.setDisplay("showSpaceRail", false)}
            />
          </div>
        </Show>
      </header>

      <div class="flex-1 min-h-0 flex flex-col min-w-0" classList={{ "hidden": !expanded() }}>
        <Show
          when={store.spaces().length > 0}
          fallback={
            <Show
              when={!store.spacesLoading}
              fallback={<div class="px-3 py-6 text-12-regular text-v2-text-text-muted">{t("common.loading")}</div>}
            >
              <div class="px-3 py-6 text-center text-12-regular text-v2-text-text-muted">
                {t("workbench.sidebar.empty")}
              </div>
            </Show>
          }
        >
          <SessionTree
            spaces={store.spaces()}
            activeSpaceName={wb.activeSpaceName}
            onSpaceClick={handleSpaceClick}
            onProjectClick={handleProjectClick}
            onSessionClick={handleSessionClick}
            onStatusMessage={showStatus}
          />
        </Show>
      </div>

      <Show when={statusMsg()}>
        <div class="shrink-0 border-t border-v2-border-border-base px-2 py-1 text-10-regular text-v2-text-text-muted">
          {statusMsg()}
        </div>
      </Show>

      <div
        classList={{
          "mt-auto flex shrink-0 border-t border-v2-border-border-base": true,
          "justify-center p-1.5": !expanded(),
          "p-2": expanded(),
        }}
      >
        <WorkbenchSettingsMenu />
      </div>

      <Show when={confirmDialog()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={cancelSwitch}
        >
          <div
            class="w-80 rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p class="mb-3 text-12-regular text-v2-text-text-base">
              {t("workbench.tabSwitch.confirm")}
            </p>
            <label class="mb-3 flex cursor-pointer items-center gap-2 text-11-regular text-v2-text-text-muted">
              <input
                type="checkbox"
                checked={dontRemindStore.suppress}
                onChange={(e) => setDontRemindStore("suppress", (e.target as HTMLInputElement).checked)}
                class="size-3.5 rounded border-v2-border-border-base"
              />
              {t("workbench.tabSwitch.dontRemind")}
            </label>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-md px-3 py-1.5 text-12-regular text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
                onClick={cancelSwitch}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                class="rounded-md bg-v2-icon-icon-brand px-3 py-1.5 text-12-regular text-white hover:opacity-90"
                onClick={confirmSwitch}
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </aside>
    <Show when={expanded()}>
      <div
        class="absolute top-0 bottom-0 w-2 cursor-col-resize bg-transparent hover:bg-v2-icon-icon-brand/30 z-30"
        style={{ left: `${sidebarWidth()}px` }}
        onMouseDown={startResize}
        title="拖动调整宽度"
      />
    </Show>
    </>
  )
}
