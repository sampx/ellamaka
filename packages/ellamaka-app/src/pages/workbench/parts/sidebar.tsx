import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { Show, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSpaceStore } from "../space-store"
import { useWorkbenchState } from "../view-store"
import { useSessionStore } from "../session-store"
import { GENERAL_SCOPE_NAME, normalizeSpacePath } from "../workbench-scope"
import { WorkbenchSettingsButton } from "./workbench-settings"
import { SessionTree } from "./session-tree"
import { ChatIcon } from "./session-tree-space"
import { Persist, persisted } from "@/utils/persist"
import { useWorkbenchRuntime } from "../workbench-runtime"

const MIN_WIDTH = 200
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 300
const COLLAPSED_WIDTH = 44

function MaintenanceIcon(props: { class?: string }) {
  return (
    <svg class={props.class ?? "size-4"} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

export function SpaceRail() {
  const store = useSpaceStore()
  const wb = useWorkbenchState()
  const sessionStore = useSessionStore()
  const runtime = useWorkbenchRuntime()
  const language = useLanguage()
  const t: typeof language.t = (k, p) => language.t(k, p)

  const expanded = createMemo(() => wb.display().showSpaceRail)
  const [widthStore, setWidthStore] = persisted(
    Persist.global("workbench.sidebarWidth", []),
    createStore({ width: DEFAULT_WIDTH }),
  )

  const sidebarWidth = () => (expanded() ? widthStore.width : COLLAPSED_WIDTH)

  const [activeNav, setActiveNav] = createSignal<"sessions" | "maintenance">("sessions")

  let asideRef: HTMLElement | undefined
  let resizeHandleRef: HTMLElement | undefined
  let resizing = false

  function startResize(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!asideRef || !resizeHandleRef) return
    resizing = true
    const startX = e.clientX
    const startWidth = widthStore.width
    asideRef.style.transition = "none"

    let rafId: number | null = null

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!resizing || !asideRef || !resizeHandleRef) return
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const delta = moveEvent.clientX - startX
        let newWidth = startWidth + delta
        if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH
        if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH
        asideRef!.style.width = `${newWidth}px`
        resizeHandleRef!.style.left = `${newWidth}px`
      })
    }

    const onMouseUp = () => {
      resizing = false
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""

      if (!asideRef) return
      asideRef.style.transition = ""
      const finalWidth = parseFloat(asideRef.style.width)
      if (!isNaN(finalWidth)) {
        setWidthStore("width", finalWidth)
      }
    }

    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.addEventListener("mousemove", onMouseMove, { passive: true })
    document.addEventListener("mouseup", onMouseUp)
  }

  function handleSpaceClick(space: { name: string; path: string; type?: string }) {
    if (space.path === wb.activeTabPath) return
    wb.openTab(space)
  }

  const [refreshing, setRefreshing] = createSignal(false)

  function handleRefresh() {
    if (!runtime.canUseSpaceControl()) return
    if (refreshing()) return
    setRefreshing(true)
    wb.triggerRefresh()
    wb.setStatusMessage(t("workbench.sidebar.refreshing"))
    setTimeout(() => {
      setRefreshing(false)
      wb.setStatusMessage(t("workbench.sidebar.refreshed"))
    }, 600)
  }

  function handleSessionClick(sessionId: string) {
    const session = sessionStore.getSession(sessionId)
    if (!session) return
    const isBound = wb.isSessionBound(sessionId)
    const boundPanelId = wb.boundPanelIdForSession(sessionId)
    const sessionSpacePath = session.spacePath ? normalizeSpacePath(session.spacePath) : ""
    const tab = wb.tabs.find((tab) => normalizeSpacePath(tab.path) === sessionSpacePath)
    if (tab) {
      wb.openTab(tab)
      if (isBound && boundPanelId) {
        wb.setActivePanel(tab.path, boundPanelId)
      }
      return
    }
    if (sessionSpacePath !== "") {
      wb.openTab({ name: session.spaceName ?? sessionSpacePath, path: sessionSpacePath, type: "space" })
      wb.ensureSpace(sessionSpacePath)
    }
  }

  // 单空间会话隔离：仅过滤当前激活空间的 WopalSpace 节点
  const activeSpaces = createMemo(() => {
    const allSpaces = [
      { name: GENERAL_SCOPE_NAME, path: "", type: "general" },
      ...store.spaces(),
    ]
    const currentPath = normalizeSpacePath(wb.activeTabPath)
    const filtered = allSpaces.filter((space) => normalizeSpacePath(space.path) === currentPath)
    return filtered.length > 0 ? filtered : [allSpaces[0]]
  })

  return (
    <>
      <aside
        ref={(el) => { asideRef = el }}
        class="flex shrink-0 border-r border-v2-border-border-base bg-v2-background-bg-deep overflow-hidden select-none"
        style={{ width: `${sidebarWidth()}px`, transition: resizing ? "none" : "width 0.15s" }}
      >
        {/* 固定 44px 竖向 Activity Bar */}
        <div class="w-11 shrink-0 flex flex-col items-center py-2.5 border-r border-v2-border-border-base bg-v2-background-bg-deep h-full z-10">
          <div class="flex flex-col gap-2.5 items-center">
            {/* 会话 Icon */}
            <IconButtonV2
              variant={activeNav() === "sessions" ? "neutral" : "ghost-muted"}
              size="normal"
              class={`size-8 p-0 flex items-center justify-center ${activeNav() === "sessions" ? "text-v2-icon-icon-accent bg-v2-overlay-simple-overlay-hover" : ""}`}
              icon={<ChatIcon class="size-4" />}
              aria-label="Sessions"
              title="Sessions"
              onClick={() => {
                if (activeNav() === "sessions") {
                  wb.setDisplay("showSpaceRail", !expanded())
                } else {
                  setActiveNav("sessions")
                  wb.setDisplay("showSpaceRail", true)
                }
              }}
            />
          </div>

          <div class="mt-auto flex flex-col items-center">
            <WorkbenchSettingsButton />
          </div>
        </div>

        {/* 侧栏面板内容 (DOM 常驻，通过 CSS 显隐保持状态与 Scroll 位置) */}
        <div class={`flex-1 min-w-0 flex flex-col h-full bg-v2-background-bg-deep ${expanded() ? "" : "hidden"}`}>
          <header class="flex h-8 shrink-0 items-center justify-between px-3 border-b border-v2-border-border-base">
            <div class="flex items-center gap-1.5 min-w-0 flex-1">
              <span class="text-11-medium text-v2-text-text-strong truncate">
                {activeNav() === "sessions" ? t("workbench.sidebar.spaces") : t("workbench.sidebar.maintenance")}
              </span>
              <IconButtonV2
                variant="ghost-muted"
                size="small"
                class="size-5 flex items-center justify-center p-0 shrink-0"
                icon={
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class={refreshing() ? "workbench-spinner" : ""}
                    style={{ "transform-origin": "center" }}
                  >
                    <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89L13.5 5.5M13.5 5.5V2m0 3.5H10" />
                  </svg>
                }
                aria-label={t("workbench.sidebar.refresh")}
                disabled={!runtime.canUseSpaceControl()}
                onClick={handleRefresh}
              />
            </div>

            <IconButtonV2
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="sidebar-right" />}
              aria-label={t("workbench.sidebar.collapse")}
              onClick={() => wb.setDisplay("showSpaceRail", false)}
            />
          </header>

            <div class={`flex-1 min-h-0 flex flex-col min-w-0 py-1 ${activeNav() === "sessions" ? "" : "hidden"}`}>
              <Show
                when={store.spaces() !== undefined}
                fallback={<div class="px-3 py-6 text-12-regular text-v2-text-text-muted">{t("common.loading")}</div>}
              >
                <SessionTree
                  spaces={activeSpaces()}
                  activeSpacePath={wb.activeTabPath}
                  onSpaceClick={handleSpaceClick}
                  onSessionClick={handleSessionClick}
                />
              </Show>
            </div>

            <div class={`flex-1 min-h-0 flex flex-col min-w-0 ${activeNav() === "maintenance" ? "" : "hidden"}`}>
              <div class="p-3 text-12-regular text-v2-text-text-muted">
                <div class="flex items-center gap-1.5 font-medium text-v2-text-text-base mb-1">
                  <MaintenanceIcon class="size-4" />
                  <span>{t("workbench.sidebar.maintenance")}</span>
                </div>
                <p>{t("workbench.sidebar.activeSpace", { name: wb.activeSpaceName })}</p>
                <p class="mt-2 text-11-regular text-v2-text-text-faint">{t("workbench.sidebar.maintenanceDesc")}</p>
              </div>
            </div>
        </div>
      </aside>

      <Show when={expanded()}>
        <div
          ref={(el) => { resizeHandleRef = el }}
          class="absolute top-0 bottom-0 w-2 cursor-col-resize bg-transparent hover:bg-v2-icon-icon-brand/30 z-30"
          style={{ left: `${sidebarWidth()}px` }}
          onMouseDown={startResize}
          title={t("workbench.sidebar.resizeHandle")}
        />
      </Show>
    </>
  )
}
