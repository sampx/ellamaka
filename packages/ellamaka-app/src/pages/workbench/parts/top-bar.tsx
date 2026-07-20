import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { ButtonV2 } from "@opencode-ai/ui/v2/components/button-v2.jsx"
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { useLanguage } from "@/context/language"
import { useWorkbenchState } from "../view-store"
import { useSpaceStore } from "../space-store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogCloseTab } from "./workspace"

function PinIcon(props: { class?: string }) {
  return (
    <svg
      class={props.class ?? "size-3 shrink-0"}
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

function FolderIcon(props: { class?: string }) {
  return (
    <svg class={props.class ?? "size-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
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
  const language = useLanguage()
  const dialog = useDialog()
  const t = (k: string, params?: Record<string, string | number | boolean>) => language.t(k, params)

  const activePath = () => wb.activeTabPath

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

        {/* Space Tabs Bar - 绝对居中算法 */}
        <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center gap-1 overflow-x-auto max-w-[60%] scrollbar-none z-10">
          <For each={wb.tabs}>
            {(tab) => {
              const isGeneral = tab.path === ""
              const isActive = () => wb.activeTabPath === tab.path
              const isPinned = isGeneral || !!tab.pinned

              return (
                <div
                  classList={{
                    "group relative flex items-center gap-1.5 h-7 px-2.5 rounded-md text-12-regular transition-all cursor-pointer shrink-0": true,
                    "bg-blue-50/80 border-blue-200 dark:bg-blue-950/40 dark:border-blue-900/50 text-v2-text-text-strong font-semibold shadow-sm": isActive(),
                    "text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover border border-transparent": !isActive(),
                  }}
                  onClick={() => wb.setActive(tab.path)}
                  onContextMenu={(e) => handleTabContextMenu(e, tab)}
                >
                  {/* 激活状态顶部指示横线 (支持亮色/暗色主题，与 Session 高亮和 Panel 保持 100% 一致) */}
                  <Show when={isActive()}>
                    <div class="absolute top-0 inset-x-0 h-[2.5px] bg-blue-600 dark:bg-blue-400 rounded-t-md shadow-sm z-10" />
                  </Show>

                  {/* Pin 状态常驻标识 Icon */}
                  <Show when={isPinned}>
                    <span class="text-v2-icon-icon-accent shrink-0 flex items-center" title={isGeneral ? "日常对话 (固定)" : "已钉住 Tab"}>
                      <PinIcon class="size-3" />
                    </span>
                  </Show>

                  <span class="max-w-28 truncate">
                    {isGeneral ? "日常对话" : tab.name}
                  </span>

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
                        <PinIcon class={`size-3 ${tab.pinned ? "text-v2-icon-icon-accent" : "text-v2-text-text-muted"}`} />
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
                          <IconV2 name="xmark-small" />
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
              class="h-7 px-2 text-12-regular text-v2-text-text-muted hover:text-v2-text-text-strong gap-1.5"
              onClick={(e) => {
                e.stopPropagation()
                setShowSpaceMenu(!showSpaceMenu())
              }}
            >
              <FolderIcon class="size-3.5" />
              <span>选择空间</span>
              <IconV2 name="outline-chevron-down" class="size-3" />
            </ButtonV2>

            <Show when={showSpaceMenu()}>
              <div class="absolute right-0 top-8 z-50 min-w-48 max-h-64 overflow-y-auto rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-1 shadow-lg">
                <div class="px-2 py-1 text-10-medium text-v2-text-text-muted uppercase tracking-wider">
                  选择空间
                </div>
                <For each={spaceStore.spaces()}>
                  {(sp) => {
                    const isOpen = () => wb.tabs.some((t) => t.path === sp.path)
                    const isActive = () => wb.activeTabPath === sp.path

                    return (
                      <button
                        type="button"
                        classList={{
                          "w-full flex items-center justify-between px-2.5 py-1.5 text-left text-12-regular rounded transition-colors": true,
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
                          <FolderIcon
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
            variant="ghost-muted"
            size="small"
            icon={<SplitPanelIcon class="size-3.5" />}
            aria-label="拆分面板"
            title="拆分面板 (最多3个)"
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
                  class="flex items-center gap-2 w-full px-3 py-1.5 text-left text-12-regular text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
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
                class="flex items-center gap-2 w-full px-3 py-1.5 text-left text-12-regular text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-40"
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
