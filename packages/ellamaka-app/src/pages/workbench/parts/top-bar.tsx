import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { ButtonV2 } from "@opencode-ai/ui/v2/components/button-v2.jsx"
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useLanguage } from "@/context/language"
import { useWorkbenchState } from "../view-store"
import { useSpaceStore } from "../space-store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useSessionStore } from "../session-store"
import { DialogCloseTab } from "./workspace"
import { useSync } from "@/context/sync"
import { useServerSync } from "@/context/server-sync"
import { useNotification } from "@/context/notification"
import { pathKey } from "@/utils/path-key"
import { SpaceIcon } from "./session-tree-space"
import { Spinner } from "@opencode-ai/ui/spinner"

function PinIcon(props: { class?: string }) {
  return (
    <svg
      class={props.class ?? "size-3.5"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-.44-1.24l-2.78-3.55A2 2 0 0 1 15 9.24V5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v4.24c0 .43-.14.85-.4 1.21L5.8 13.97A2 2 0 0 0 5 15.24V17z" />
    </svg>
  )
}

// 拆分面板图标 (Split Panel Box with Plus Icon)
function SplitPanelIcon(props: { class?: string }) {
  return (
    <svg class={props.class ?? "size-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <path d="M16 9v6" />
      <path d="M13 12h6" />
    </svg>
  )
}

function CheckIcon(props: { class?: string }) {
  return (
    <svg class={props.class ?? "size-3.5 shrink-0"} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

type TabContextMenu = { x: number; y: number; tab: { name: string; path: string; pinned?: boolean } }

export function WorkbenchTitlebar() {
  const wb = useWorkbenchState()
  const spaceStore = useSpaceStore()
  const sessionStore = useSessionStore()
  const language = useLanguage()
  const dialog = useDialog()
  const notification = useNotification()
  const t = (k: string, params?: Record<string, string | number | boolean>) => language.t(k, params)

  let sync: ReturnType<typeof useSync> | undefined
  let serverSync: ReturnType<typeof useServerSync> | undefined
  try {
    sync = useSync()
    serverSync = useServerSync()
  } catch {
    // Safe fallback when rendered outside SyncProvider
  }

  const activePath = () => wb.activeTabPath

  const getTabForDirectory = (dirPath: string): string => {
    const dirKey = pathKey(dirPath ?? "").toLowerCase()
    if (!dirKey) return ""
    if (dirKey === "general") return ""

    for (const tab of wb.tabs) {
      if (!tab.path) continue
      const tabDir = pathKey(tab.path).toLowerCase()
      if (dirKey === tabDir || dirKey.startsWith(tabDir + "/") || dirKey.startsWith(tabDir + "\\")) {
        return tab.path
      }
    }
    return ""
  }

  const isSpaceWorking = (tabPath: string, _tabName?: string) => {
    if (!serverSync) return false
    const targetPath = tabPath ?? ""

    for (const [rawKey, [childStore]] of Object.entries(serverSync.children)) {
      if (getTabForDirectory(rawKey) === targetPath) {
        if (Object.keys(childStore.session_status).some((id) => childStore.session_working(id))) {
          return true
        }
      }
    }
    return false
  }

  // 未读蓝点：严格由本空间在 SessionStore 中是否存在【未读会话 (unseenCount > 0)】动态计算。
  // 与侧边栏 Session 列表蓝点使用同一事实源，避免孤立目录通知造成空间 Tab 蓝点常亮。
  const isSpaceUnread = (tabPath: string, tabName?: string) => {
    const isGeneral = tabPath === ""
    const allSpaces = sessionStore.sessions()
    const targetPath = pathKey(tabPath ?? "").toLowerCase()
    const targetName = (tabName ?? "").toLowerCase()

    for (const [spaceKey, sessions] of Object.entries(allSpaces)) {
      const keyLower = pathKey(spaceKey).toLowerCase()
      let isMatch = false

      if (isGeneral) {
        if (spaceKey === "" || keyLower === "general" || keyLower === "sessions") {
          isMatch = true
        }
      } else {
        if (
          (targetPath && keyLower === targetPath) ||
          (targetName && keyLower === targetName)
        ) {
          isMatch = true
        }
      }

      for (const s of sessions) {
        if (!isMatch) {
          const sPath = pathKey(s.spacePath ?? "").toLowerCase()
          const sName = (s.spaceName ?? "").toLowerCase()
          if (
            (!isGeneral && ((targetPath && sPath === targetPath) || (targetName && sName === targetName))) ||
            (isGeneral && (sPath === "" || sName === "general" || sName === "sessions"))
          ) {
            if (notification.session.unseenCount(s.id) > 0) return true
          }
        } else {
          if (notification.session.unseenCount(s.id) > 0) return true
        }
      }
    }
    return false
  }

  const [showSpaceMenu, setShowSpaceMenu] = createSignal(false)
  const [tabMenu, setTabMenu] = createSignal<TabContextMenu>()
  let spaceMenuRef: HTMLDivElement | undefined

  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (spaceMenuRef && !spaceMenuRef.contains(e.target as Node)) {
        setShowSpaceMenu(false)
      }
      setTabMenu(undefined)
    }
    document.addEventListener("click", handleClickOutside)
    onCleanup(() => document.removeEventListener("click", handleClickOutside))
  })

  const handleCloseTab = (name: string, path: string) => {
    void dialog.show(() => <DialogCloseTab name={name} path={path} />)
  }

  const handleTabContextMenu = (e: MouseEvent, tab: { name: string; path: string; pinned?: boolean }) => {
    e.preventDefault()
    e.stopPropagation()
    setTabMenu({ x: e.clientX, y: e.clientY, tab })
  }

  const currentSpacePanelsCount = () => {
    const space = wb.spaceState(activePath())
    return space?.panels.length ?? 0
  }

  return (
    <header class="relative z-40 flex shrink-0 flex-col bg-v2-background-bg-base border-b border-v2-border-border-base select-none">
      <div data-tauri-drag-region class="workbench-macos-window-chrome shrink-0" />
      <div data-tauri-drag-region class="workbench-titlebar-toolbar relative flex h-10 items-center justify-between px-3">
        {/* Brand Logo - Left side */}
        <div class="flex items-center gap-2 text-v2-text-text-strong [font-weight:530] text-14-regular shrink-0 z-20">
          <img src="/favicon-96x96.png" class="w-5 h-5 object-contain" alt="Icon" />
          <img src="/ellamaka-text-logo.png?v=2" class="h-5 w-auto object-contain ellamaka-logo-invert" alt="Logo" />
        </div>

        {/* Space Tabs Bar - 绝对居中与全高自适应 (解决容器裁剪横线问题) */}
        <div
          role="tablist"
          class="absolute left-1/2 top-0 bottom-0 -translate-x-1/2 flex items-center justify-center gap-1 h-10 overflow-x-auto max-w-[60%] scrollbar-none z-10"
          style={{ "-webkit-app-region": "no-drag" }}
        >
          <For each={wb.tabs}>
            {(tab) => {
              const isGeneral = tab.path === ""
              const isActive = () => {
                if (wb.activeTabPath === tab.path) return true
                if (tab.path !== undefined && wb.activeTabPath !== undefined) {
                  return pathKey(wb.activeTabPath).toLowerCase() === pathKey(tab.path).toLowerCase()
                }
                return false
              }
              const isPinned = isGeneral || !!tab.pinned

              return (
                <div
                  role="tab"
                  tabIndex={0}
                  aria-selected={isActive()}
                  class={`group relative flex items-center justify-center gap-1.5 h-full px-3 transition-all cursor-pointer shrink-0 ${
                    isActive()
                      ? "text-v2-text-text-strong font-semibold"
                      : "text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover font-medium"
                  }`}
                  style={{ "-webkit-app-region": "no-drag" }}
                  onClick={() => wb.setActive(tab.path)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      wb.setActive(tab.path)
                    }
                  }}
                  onContextMenu={(e: MouseEvent) => handleTabContextMenu(e, tab)}
                >
                  {/* 活动指示器 / 激活状态高亮横线 */}
                  <Show when={isActive()}>
                    <div class="absolute top-0 inset-x-0 transition-all bg-v2-icon-icon-accent h-[3px]" />
                  </Show>

                  {/* Pin 状态常驻标识 Icon */}
                  <Show when={isPinned}>
                    <span class="text-v2-icon-icon-accent shrink-0 flex items-center" title={t(isGeneral ? "workbench.topbar.generalPinned" : "workbench.topbar.tabPinned")}>
                      <PinIcon class="size-3.5" />
                    </span>
                  </Show>

                  <span class="max-w-32 truncate text-center text-[13px] leading-none">
                    {isGeneral ? t("workbench.sidebar.sessions") : tab.name}
                  </span>

                  {/* 空间内部会话后台运行动效 */}
                  <Show when={isSpaceWorking(tab.path, tab.name)}>
                    <Spinner class="size-3.5 shrink-0 text-v2-icon-icon-accent" />
                  </Show>

                  {/* 后台会话完成未读指示蓝点 */}
                  <Show when={!isSpaceWorking(tab.path, tab.name) && isSpaceUnread(tab.path, tab.name)}>
                    <div class="size-2 rounded-full shrink-0 bg-v2-icon-icon-accent" />
                  </Show>

                  {/* Actions for Space Tabs */}
                  <Show when={!isGeneral}>
                    <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        class="p-0.5 rounded text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-background-bg-base"
                        title={tab.pinned ? "取消钉住" : "钉住 Tab"}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (tab.pinned) {
                            wb.unpinTab(tab.path)
                          } else {
                            wb.pinTab(tab.path)
                          }
                        }}
                      >
                        <PinIcon class={`size-3.5 ${tab.pinned ? "text-v2-icon-icon-accent" : "text-v2-text-text-muted"}`} />
                      </button>
                      <Show when={!tab.pinned}>
                        <button
                          type="button"
                          class="p-0.5 rounded text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-background-bg-base"
                          title="关闭 Tab"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCloseTab(tab.name, tab.path)
                          }}
                        >
                          <IconV2 name="xmark-small" class="size-3.5" />
                        </button>
                      </Show>
                    </div>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>

        {/* Right Nav: Space Selector & Split Panel Button */}
        <div class="flex items-center gap-1.5 shrink-0 z-20">
          {/* 选择空间 下拉选择框 */}
          <div class="relative" ref={(el) => { spaceMenuRef = el }}>
            <ButtonV2
              variant="ghost"
              size="small"
              class="h-7 px-2.5 text-[13px] font-medium text-v2-text-text-muted hover:text-v2-text-text-strong gap-1.5"
              onClick={(e: MouseEvent) => {
                e.stopPropagation()
                setShowSpaceMenu(!showSpaceMenu())
              }}
            >
              <SpaceIcon class="size-3.5" />
              <span class="text-[13px] font-medium leading-none">{t("workbench.topbar.selectSpace")}</span>
              <IconV2 name="outline-chevron-down" class="size-3.5" />
            </ButtonV2>

            <Show when={showSpaceMenu()}>
              <div class="absolute right-0 top-8 z-50 min-w-48 max-h-64 overflow-y-auto rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-1 shadow-lg">
                <div class="px-2 py-1 text-10-medium text-v2-text-text-muted uppercase tracking-wider">
                  {t("workbench.topbar.selectSpace")}
                </div>
                <For each={spaceStore.spaces()}>
                  {(sp) => {
                    const isOpen = () => wb.tabs.some((t) => t.path === sp.path)
                    const isActive = () => wb.activeTabPath === sp.path

                    return (
                      <button
                        type="button"
                        classList={{
                          "w-full flex items-center justify-between px-2.5 py-1.5 text-left text-[13px] rounded transition-colors": true,
                          "bg-v2-overlay-simple-overlay-hover text-v2-text-text-strong font-semibold": isActive(),
                          "text-v2-text-text-strong font-medium hover:bg-v2-overlay-simple-overlay-hover": isOpen() && !isActive(),
                          "text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover": !isOpen(),
                        }}
                        onClick={() => {
                          wb.openTab(sp)
                          setShowSpaceMenu(false)
                        }}
                      >
                        <div class="flex items-center gap-2 truncate">
                          <SpaceIcon
                            class={`size-3.5 shrink-0 ${isOpen() ? "text-v2-icon-icon-accent" : "text-v2-text-text-muted"}`}
                          />
                          <span class="truncate">{sp.name.replace(/[\s+*]+$/, "").trim()}</span>
                        </div>
                        <Show when={isActive()}>
                          <CheckIcon class="size-3.5 text-v2-icon-icon-accent shrink-0" />
                        </Show>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>

          {/* 拆分面板 按钮 (最右侧，使用 SplitPanelIcon) */}
          <IconButtonV2
            variant="ghost"
            size="small"
            class="text-v2-text-text-muted hover:text-v2-text-text-strong"
            icon={<SplitPanelIcon class="size-3.5" />}
            aria-label={t("workbench.topbar.splitPanel")}
            title={t("workbench.topbar.splitPanelHint")}
            disabled={currentSpacePanelsCount() >= 3}
            onClick={() => {
              const id = wb.addPanel(activePath())
              if (id) wb.setActivePanel(activePath(), id)
            }}
          />
        </div>
      </div>

      {/* Right Click Tab Context Menu */}
      <Show when={tabMenu()}>
        {(menu) => {
          const tab = menu().tab
          const isGeneral = tab.path === ""
          const isPinned = isGeneral || !!tab.pinned

          return (
            <div
              class="fixed z-50 min-w-36 rounded-md border border-v2-border-border-base bg-v2-background-bg-base shadow-lg py-1 select-none"
              style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
              onClick={(e) => e.stopPropagation()}
            >
              <Show when={!isGeneral}>
                <button
                  type="button"
                  class="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                  onClick={() => {
                    if (tab.pinned) wb.unpinTab(tab.path)
                    else wb.pinTab(tab.path)
                    setTabMenu(undefined)
                  }}
                >
                  <PinIcon class="size-3.5 text-v2-icon-icon-accent" />
                  <span>{tab.pinned ? "取消钉住 Tab" : "钉住 Tab"}</span>
                </button>
                <div class="my-1 border-t border-v2-border-border-base" />
              </Show>

              <button
                type="button"
                class="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-40"
                disabled={isPinned}
                onClick={() => {
                  if (!isPinned) handleCloseTab(tab.name, tab.path)
                  setTabMenu(undefined)
                }}
              >
                <IconV2 name="xmark-small" class="size-3.5" />
                <span>关闭 Tab</span>
              </button>
            </div>
          )
        }}
      </Show>
    </header>
  )
}
