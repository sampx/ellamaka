import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { For, Show, createSignal, createMemo, createEffect, onCleanup, onMount, untrack, batch } from "solid-js"
import { createStore } from "solid-js/store"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { useSessionStore } from "../session-store"
import { useWorkbenchState, type WorkbenchPanel } from "../view-store"
import { setInvisibleSessionDragPreview } from "./session-tree-drag-preview"
import { mergeSessionTreeSessions } from "./session-tree-merge"
import type { WopalSpace } from "../space-store"
import { ptyManager, ptyReferences } from "../pty-manager"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"

type ContextMenu = {
  x: number
  y: number
  items: ContextMenuItem[]
}

type ContextMenuItem = {
  label: string
  action: () => void
}

type MergedSession = {
  id: string
  title: string
  status: "idle" | "bound" | "archived"
}

type GroupSession = {
  id: string
  title: string
  directory: string
  directoryHealth: "healthy" | "missing" | "unavailable"
  agent?: string
  timeCreated: number
  timeUpdated: number
}

type SessionGroup = {
  id: string
  title: string
  type: "space" | "general"
  sessionCount: number
  sessions: GroupSession[]
}

export function SessionTree(props: {
  spaces: WopalSpace[]
  activeSpaceName: string | undefined
  pendingSpacePath?: string | undefined
  onSpaceClick: (space: WopalSpace) => void
  onProjectClick: (spaceName: string, projectPath: string) => void
  onSessionClick: (sessionId: string) => void
}) {
  const sdk = useServerSDK()
  const language = useLanguage()
  const t = (k: string, params?: Record<string, string | number | boolean>) => language.t(k as Parameters<typeof language.t>[0], params)
  const sessionStore = useSessionStore()
  const wb = useWorkbenchState()
  const dialog = useDialog()



  const EXPAND_STORAGE_KEY = "workbench.tree.expanded"
  const PINNED_STORAGE_KEY = "workbench.tree.pinned"

  function loadExpanded(): string[] {
    try {
      const raw = localStorage.getItem(EXPAND_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return parsed.spaces ?? []
    } catch {
      return []
    }
  }

  function loadPinned(): string[] {
    try {
      const raw = localStorage.getItem(PINNED_STORAGE_KEY)
      if (!raw) return []
      return JSON.parse(raw) ?? []
    } catch {
      return []
    }
  }

  const saved = loadExpanded()
  const initialSpaces = new Set(saved)
  if (props.activeSpaceName) initialSpaces.add(props.activeSpaceName)

  const [expandedSpaces, setExpandedSpaces] = createSignal<Set<string>>(initialSpaces)
  const [pinnedSessions, setPinnedSessions] = createSignal<Set<string>>(new Set(loadPinned()))
  const [contextMenu, setContextMenu] = createSignal<ContextMenu | null>(null)
  const [groupCache, setGroupCache] = createStore<Record<string, SessionGroup[]>>({})
  const [allGroups, setAllGroups] = createStore<SessionGroup[]>([])
  const [loading, setLoading] = createSignal(false)
  let fetchVersion = -1

  const activeSessionId = createMemo(() => {
    const tab = wb.activeTab()
    if (!tab) return undefined
    const state = wb.spaceState(tab.path)
    if (!state) return undefined
    const panel = state.panels.find((p) => p.id === state.activePanelID)
    return panel?.slotState === "bound" ? panel.boundSessionId : undefined
  })

  createEffect(() => {
    const id = activeSessionId()
    if (!id) return
    const session = sessionStore.getSession(id)
    if (!session) return

    setExpandedSpaces((prev) => {
      if (prev.has(session.spaceName)) return prev
      const next = new Set(prev)
      next.add(session.spaceName)
      return next
    })
  })

  function isSessionBound(sessionId: string): boolean {
    for (const spacePath of Object.keys(wb.spaces)) {
      const space = wb.spaces[spacePath]
      if (space?.panels?.some((p) => p.boundSessionId === sessionId && p.slotState === "bound")) {
        return true
      }
    }
    return false
  }

  function getPanelBadge(sessionId: string): string | undefined {
    const activePath = wb.activeTab()?.path
    if (activePath !== undefined) {
      const space = wb.spaces[activePath]
      const idx = space?.panels?.findIndex((p) => p.boundSessionId === sessionId && p.slotState === "bound") ?? -1
      if (idx !== -1) return `P${idx + 1}`
    }

    for (const spPath of Object.keys(wb.spaces)) {
      if (spPath === activePath) continue
      const otherSpace = wb.spaces[spPath]
      const otherIdx = otherSpace?.panels?.findIndex((p) => p.boundSessionId === sessionId && p.slotState === "bound") ?? -1
      if (otherIdx !== -1) return `P${otherIdx + 1}`
    }
    return undefined
  }

  function getSessionsForSpace(spaceName: string): GroupSession[] {
    if (spaceName === "General") {
      return allGroups
        .filter((g) => g.type === "general")
        .flatMap((g) => g.sessions)
    }
    const space = props.spaces.find((s) => s.name === spaceName)
    if (!space) return []
    return allGroups
      .filter((g) => g.type === "space" && g.id === spaceName)
      .flatMap((g) => g.sessions)
  }

  function mergeSessions(serverSessions: GroupSession[]): MergedSession[] {
    const simplified = serverSessions.map((s) => ({
      id: s.id,
      title: s.title,
    }))
    const merged = mergeSessionTreeSessions(simplified, isSessionBound)
    const pinned = pinnedSessions()
    const pinnedList: MergedSession[] = []
    const unpinnedList: MergedSession[] = []
    for (const s of merged) {
      if (pinned.has(s.id)) {
        pinnedList.push(s)
      } else {
        unpinnedList.push(s)
      }
    }
    return [...pinnedList, ...unpinnedList]
  }

  function syncGroupTitles(spaceName: string, sessions: GroupSession[]) {
    batch(() => {
      for (const s of sessions) {
        sessionStore.ensureSessionReference(
          s.id,
          spaceName,
          s.directory,
          (s.agent === "tui" ? "tui" : "chat"),
          s.title,
        )
        sessionStore.syncSessionReference(s.id, { directoryHealth: s.directoryHealth })
      }
    })
  }

  let treeContainerRef: HTMLDivElement | undefined
  let scrollTimeout: any = null

  const handleScroll = (e: Event) => {
    const target = e.currentTarget as HTMLDivElement
    if (!target) return
    const scrollTop = target.scrollTop
    if (scrollTimeout) clearTimeout(scrollTimeout)
    scrollTimeout = setTimeout(() => {
      sessionStorage.setItem("workbench.tree.scrollTop", String(scrollTop))
    }, 100)
  }

  onMount(() => {
    const handler = () => setContextMenu(null)
    document.addEventListener("click", handler)

    const savedScrollTop = sessionStorage.getItem("workbench.tree.scrollTop")
    if (savedScrollTop && treeContainerRef) {
      setTimeout(() => {
        if (treeContainerRef) {
          treeContainerRef.scrollTop = Number(savedScrollTop)
        }
      }, 50)
    }

    // 30-second visible tree refresh (D-04)
    const VISIBLE_REFRESH_MS = 30_000
    const treeInterval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadSessionGroups()
      }
    }, VISIBLE_REFRESH_MS)

    // Refresh tree when page becomes visible again (D-04)
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadSessionGroups(true)
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)

    onCleanup(() => {
      document.removeEventListener("click", handler)
      clearInterval(treeInterval)
      document.removeEventListener("visibilitychange", handleVisibility)
      if (scrollTimeout) clearTimeout(scrollTimeout)
    })
  })

  // Persist expand state and pinned state to localStorage
  createEffect(() => {
    const spaces = [...expandedSpaces()]
    try {
      localStorage.setItem(EXPAND_STORAGE_KEY, JSON.stringify({ spaces, projects: [], dirs: [] }))
    } catch {}
  })

  createEffect(() => {
    const pinned = [...pinnedSessions()]
    try {
      localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinned))
    } catch {}
  })

  function toggleSpace(spaceName: string) {
    setExpandedSpaces((prev) => {
      const next = new Set(prev)
      if (next.has(spaceName)) next.delete(spaceName)
      else next.add(spaceName)
      return next
    })
  }

  function normalizeSessionCount(n: number | string): number {
    return typeof n === "number" ? n : 0
  }

  function normalizeTimestamp(n: number | string): number {
    return typeof n === "number" ? n : 0
  }

  async function loadSessionGroups(force = false) {
    const currentKey = sessionStore.refreshKey()
    if (!force && allGroups.length > 0 && currentKey === fetchVersion) return
    fetchVersion = currentKey
    setLoading(true)

    try {
      const res = await sdk.client.workbench.sessionGroups()
      const rawGroups = res.data?.groups ?? []
      const groups: SessionGroup[] = rawGroups.map((g) => ({
        id: g.id,
        title: g.title,
        type: g.type,
        sessionCount: normalizeSessionCount(g.sessionCount),
        sessions: (g.sessions ?? []).map((s) => ({
          id: s.id,
          title: s.title,
          directory: s.directory,
          directoryHealth: s.directoryHealth,
          agent: s.agent,
          timeCreated: normalizeTimestamp(s.timeCreated),
          timeUpdated: normalizeTimestamp(s.timeUpdated),
        })),
      }))
      setAllGroups(groups)
    } catch (e) {
      console.error("loadSessionGroups error:", e)
      setAllGroups([])
    } finally {
      setLoading(false)
    }
  }


  function handleSessionClick(sessionId: string) {
    props.onSessionClick(sessionId)
  }

  function showSessionMenu(e: MouseEvent, session: MergedSession, spaceName: string) {
    e.preventDefault()
    e.stopPropagation()
    const isPinned = pinnedSessions().has(session.id)
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: t("workbench.tree.rename"),
          action: () => {
            let inputEl: HTMLInputElement | undefined
            const [val, setVal] = createSignal(session.title)

            dialog.show(() => (
              <Dialog title={t("workbench.tree.rename") || "重命名会话"} fit>
                <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[320px]">
                  <div class="flex flex-col gap-2">
                    <input
                      ref={inputEl}
                      type="text"
                      class="w-full px-3 py-1.5 text-12-regular text-text-strong bg-v2-background-bg-deep border border-v2-border-border-base rounded-md focus:outline-none focus:border-v2-border-border-brand-strong"
                      value={val()}
                      onInput={(e) => setVal(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const trimmed = val().trim()
                          if (trimmed && trimmed !== session.title) {
                            sessionStore.renameSession(session.id, trimmed)
                            void sdk.client.session.update({ sessionID: session.id, title: trimmed }).catch(() => {})
                          }
                          dialog.close()
                        }
                        if (e.key === "Escape") dialog.close()
                      }}
                    />
                  </div>
                  <div class="flex justify-end gap-2">
                    <Button variant="ghost" size="large" onClick={() => dialog.close()}>
                      {t("common.cancel") || "取消"}
                    </Button>
                    <Button
                      variant="primary"
                      size="large"
                      onClick={() => {
                        const trimmed = val().trim()
                        if (trimmed && trimmed !== session.title) {
                          sessionStore.renameSession(session.id, trimmed)
                          void sdk.client.session.update({ sessionID: session.id, title: trimmed }).catch(() => {})
                        }
                        dialog.close()
                      }}
                    >
                      {t("common.confirm") || "确认"}
                    </Button>
                  </div>
                </div>
              </Dialog>
            ))

            setTimeout(() => {
              inputEl?.focus()
              inputEl?.select()
            }, 50)
          },
        },
        {
          label: isPinned ? t("workbench.tree.unpin") : t("workbench.tree.pin"),
          action: () => {
            setPinnedSessions((prev) => {
              const next = new Set(prev)
              if (next.has(session.id)) next.delete(session.id)
              else next.add(session.id)
              return next
            })
          },
        },
        {
          label: t("common.delete"),
          action: () => {
            dialog.show(() => (
              <Dialog title={t("common.delete") || "删除会话"} fit>
                <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[320px]">
                  <div class="flex flex-col gap-1">
                    <span class="text-14-regular text-text-strong">
                      {t("workbench.tree.deleteConfirmText", { title: session.title }) || `确定要删除会话 "${session.title}" 吗？`}
                    </span>
                    <span class="text-12-regular text-text-muted">
                      {t("workbench.tree.deleteConfirmHint") || "删除后，该会话记录将从列表中彻底移除。"}
                    </span>
                  </div>
                  <div class="flex justify-end gap-2">
                    <Button variant="ghost" size="large" onClick={() => dialog.close()}>
                      {t("common.cancel") || "取消"}
                    </Button>
                    <Button
                      variant="primary"
                      size="large"
                      onClick={async () => {
                        try {
                          await sdk.client.session.delete({ sessionID: session.id, directory: "" })
                          sessionStore.deleteSession(session.id)
                          wb.unbindSessionGlobal(session.id)
                        } catch (err) {
                          console.error("Failed to delete session:", err)
                        }
                        dialog.close()
                      }}
                    >
                      {t("common.confirm") || "确认"}
                    </Button>
                  </div>
                </div>
              </Dialog>
            ))
          },
        },
      ],
    })
  }

  function showSpaceMenu(e: MouseEvent, space: WopalSpace) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: t("workbench.tree.newSession"),
          action: async () => {
            try {
              const target = space.name === "General"
                ? { type: "general" as const }
                : { type: "space" as const, space: space.name }

              const res = await sdk.client.workbench.createSession({ target })
              const serverSession = res.data
              if (!serverSession?.id) return
              const title = serverSession.title ?? t("workbench.tree.newSession")
              sessionStore.ensureSessionReference(serverSession.id, space.name, serverSession.directory, "chat", title)
              sessionStore.triggerRefresh()

              if (wb.activeSpaceName !== space.name) {
                wb.setActive(space.name)
              }

              wb.ensureSpace(space.path)
              const targetSpaceState = wb.spaces[space.path]
              if (targetSpaceState) {
                let targetPanel = targetSpaceState.panels.find((p) => p.slotState === "empty")
                if (!targetPanel && targetSpaceState.panels.length < 3) {
                  const newPanelId = wb.addPanel(space.path)
                  if (newPanelId) {
                    const updatedSpace = wb.spaces[space.path]
                    targetPanel = updatedSpace?.panels?.find((p) => p.id === newPanelId)
                  }
                }
                if (targetPanel) {
                  wb.bindSessionToPanel(space.path, targetPanel.id, serverSession.id)
                  wb.setPanelViewMode(space.path, targetPanel.id, "chat")
                  wb.setActivePanel(space.path, targetPanel.id)
                }
              }
            } catch (err) {
              console.error("Failed to create session:", err)
            }
          },
        },
      ],
    })
  }

  function statusDotClass(status: string) {
    if (status === "bound") return "bg-green-400"
    if (status === "archived") return "bg-v2-text-text-faint"
    return "bg-v2-icon-icon-muted"
  }

  function renderSessionRow(session: MergedSession, spaceName: string, sessions: GroupSession[]) {
    const sessionData = sessions.find((s) => s.id === session.id)
    const dirHealth = sessionData?.directoryHealth ?? "healthy"

    const handleSessionClick = () => {
      const badge = getPanelBadge(session.id)
      if (badge) {
        let boundSpacePath: string | undefined
        let boundPanelId: string | undefined

        for (const spPath of Object.keys(wb.spaces)) {
          const spaceState = wb.spaces[spPath]
          const p = spaceState?.panels?.find((panel) => panel.boundSessionId === session.id && panel.slotState === "bound")
          if (p) {
            boundSpacePath = spPath
            boundPanelId = p.id
            break
          }
        }

        if (boundSpacePath && boundPanelId) {
          const targetSpace = props.spaces.find((s) => s.path === boundSpacePath)
          if (targetSpace) {
            wb.openTab(targetSpace)
          }
          wb.setActivePanel(boundSpacePath, boundPanelId)
          wb.setStatusMessage(t("workbench.status.panelActivated", { badge }))
        }
      } else {
        const targetSpace = props.spaces.find((s) => s.name === spaceName)
        if (targetSpace) {
          wb.openTab(targetSpace)
          wb.ensureSpace(targetSpace.path)
        }
        wb.setStatusMessage(t("workbench.status.defaultHint"))
      }
      props.onSessionClick(session.id)
    }

    function DialogOverwritePanel(props: {
      panelIndex: number
      onConfirm: () => void
    }) {
      return (
        <Dialog title={t("workbench.panel.overwriteTitle") || "覆盖会话窗口"} fit>
          <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[320px]">
            <div class="flex flex-col gap-1">
              <span class="text-14-regular text-text-strong">
                {t("workbench.panel.overwriteConfirmText", { index: String(props.panelIndex) }) || `确定要覆盖面板 #${props.panelIndex} 的当前会话吗？`}
              </span>
              <span class="text-12-regular text-text-muted">
                {t("workbench.panel.overwriteConfirmHint") || "覆盖后原有会话将自动解绑，您可以在左侧会话列表中随时重新恢复。"}
              </span>
            </div>
            <div class="flex justify-end gap-2">
              <Button variant="ghost" size="large" onClick={() => dialog.close()}>
                {t("common.cancel") || "取消"}
              </Button>
              <Button variant="primary" size="large" onClick={props.onConfirm}>
                {t("common.confirm") || "确认"}
              </Button>
            </div>
          </div>
        </Dialog>
      )
    }

    const handleSessionDblClick = () => {
      const badge = getPanelBadge(session.id)
      if (badge) {
        handleSessionClick()
        return
      }

      const targetSpace = props.spaces.find((s) => s.name === spaceName)
      if (!targetSpace) return

      const targetSpacePath = targetSpace.path

      const loadSessionIntoPanel = (panel: WorkbenchPanel) => {
        if (panel.slotState === "bound") {
          // 先物理杀死并注销该面板原有的 PTY 资源，并解绑
          void ptyManager.disposePanel(targetSpacePath, panel.id, sdk, ptyReferences(panel))

          // 清理原有面板上关联 of PTY ID
          wb.setPanelPtyId(targetSpacePath, panel.id, "tui", undefined)
          wb.setPanelPtyId(targetSpacePath, panel.id, "term", undefined)
          wb.setPanelPtyId(targetSpacePath, panel.id, "split", undefined)
          wb.setPanelSplitTerminal(targetSpacePath, panel.id, false)

          wb.unbindSessionFromPanel(targetSpacePath, panel.id)
        }

        let localSession = sessionStore.getSession(session.id)
        if (!localSession) {
          const projectPath = sessionData?.directory ?? targetSpacePath
          localSession = sessionStore.ensureSessionReference(session.id, spaceName, projectPath, "chat", session.title)
        }
        wb.bindSessionToPanel(targetSpacePath, panel.id, session.id)
        wb.setPanelViewMode(targetSpacePath, panel.id, "chat")
        wb.setActivePanel(targetSpacePath, panel.id)

        const newBadge = getPanelBadge(session.id)
        wb.setStatusMessage(t("workbench.status.sessionLoaded", { badge: newBadge ?? "" }))
      }

      wb.openTab(targetSpace)
      wb.ensureSpace(targetSpacePath)

      const space = wb.spaces[targetSpacePath]
      if (!space || !space.panels || space.panels.length === 0) return

      let targetPanel = space.panels.find((p) => p.slotState === "empty")

      if (!targetPanel && space.panels.length < 3) {
        const newPanelId = wb.addPanel(targetSpacePath)
        if (newPanelId) {
          const updatedSpace = wb.spaces[targetSpacePath]
          targetPanel = updatedSpace?.panels?.find((p) => p.id === newPanelId)
        }
      }

      if (!targetPanel) {
        const activePanelId = space.activePanelID
        const activePanel = space.panels.find((p) => p.id === activePanelId)
        if (activePanel) {
          const idx = space.panels.findIndex((p) => p.id === activePanelId)
          dialog.show(() => (
            <DialogOverwritePanel
              panelIndex={idx + 1}
              onConfirm={() => {
                loadSessionIntoPanel(activePanel)
                dialog.close()
              }}
            />
          ))
        } else {
          dialog.show(() => (
            <DialogOverwritePanel
              panelIndex={1}
              onConfirm={() => {
                loadSessionIntoPanel(space.panels[0])
                dialog.close()
              }}
            />
          ))
        }
      } else {
        loadSessionIntoPanel(targetPanel)
      }
    }

    let sessionEl: HTMLButtonElement | undefined

    createEffect(() => {
      if (session.id === activeSessionId() && sessionEl) {
        setTimeout(() => {
          sessionEl?.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }, 150)
      }
    })

    return (
      <button
        ref={sessionEl}
        type="button"
        class="group flex w-full items-center gap-2 px-2 py-0.5 text-left text-11-regular transition-all"
        classList={{
          "bg-blue-50/80 dark:bg-blue-950/40 text-v2-text-text-strong border-l-[3px] border-v2-border-border-brand-strong rounded-l-none pl-1.25 font-semibold shadow-sm": session.id === activeSessionId(),
          "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base rounded-md": session.id !== activeSessionId(),
        }}
        draggable={true}
        onDragStart={(e) => {
          const dataTransfer = e.dataTransfer
          if (!dataTransfer) return
          dataTransfer.setData("text/sessionId", session.id)
          dataTransfer.setData("text/spaceName", spaceName)
          dataTransfer.setData("text/projectPath", sessionData?.directory ?? "")
          dataTransfer.setData("text/sessionTitle", session.title)
          setInvisibleSessionDragPreview(dataTransfer)
        }}
        onClick={handleSessionClick}
        onDblClick={handleSessionDblClick}
        onContextMenu={(e) => showSessionMenu(e, session, spaceName)}
        title={dirHealth !== "healthy" ? "工作目录不可用" : undefined}
      >
        <Show when={getPanelBadge(session.id)}
          fallback={
            <Show when={dirHealth !== "healthy"}
              fallback={<span class={`size-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`} />}
            >
              <span class="flex items-center justify-center shrink-0 text-[11px] leading-none text-amber-500" title="工作目录不可用">!</span>
            </Show>
          }
        >
          {(badge) => (
            <span class="flex items-center justify-center shrink-0 rounded-full px-1.25 text-[10px] font-semibold text-white bg-v2-icon-icon-brand leading-none min-w-[20px] h-4.5 select-none">
              {badge()}
            </span>
          )}
        </Show>
        <span class="flex-1 truncate">{session.title}</span>
        <Show when={dirHealth !== "healthy"}>
          <span class="text-9-regular text-v2-text-text-faint shrink-0" title="工作目录不可用">{dirHealth === "missing" ? "缺失" : "不可用"}</span>
        </Show>
        <Show when={pinnedSessions().has(session.id)}>
          <svg class="size-3 shrink-0 text-v2-icon-icon-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="17" x2="12" y2="22"></line>
            <path d="M5 17h14v-1.76a2 2 0 0 0-.44-1.24l-2.78-3.55A2 2 0 0 1 15 9.24V5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v4.24c0 .43-.14.85-.4 1.21L5.8 13.97A2 2 0 0 0 5 15.24V17z"></path>
          </svg>
        </Show>
      </button>
    )
  }

  return (
    <div
      ref={treeContainerRef}
      class="flex-1 overflow-y-auto px-1.5"
      onScroll={handleScroll}
    >
      <For each={props.spaces}>
        {(space) => {
          const isActive = space.name === props.activeSpaceName
          const isExpanded = createMemo(() => expandedSpaces().has(space.name))
          const isPending = createMemo(() => props.pendingSpacePath !== undefined && props.pendingSpacePath === space.path)

          // Trigger group load when expanded
          createEffect(() => {
            if (isExpanded() && allGroups.length === 0) {
              untrack(() => loadSessionGroups())
            }
          })

          // Trigger group load when session store requires a refresh
          createEffect(() => {
            const key = sessionStore.refreshKey()
            void key
            if (untrack(isExpanded)) {
              untrack(() => loadSessionGroups())
            }
          })

          // Trigger group load when user manually clicks refresh button
          createEffect(() => {
            const ver = wb.refreshVersion
            if (ver > 0 && untrack(isExpanded)) {
              untrack(() => loadSessionGroups(true))
            }
          })

          const sessions = createMemo(() => getSessionsForSpace(space.name))
          const mergedSessions = createMemo(() => {
            const raw = sessions()
            syncGroupTitles(space.name, raw)
            return mergeSessions(raw)
          })

          return (
            <div>
              <button
                type="button"
                classList={{
                  "group flex w-full items-center gap-2 text-left transition-all py-1.5": true,
                  "bg-v2-background-bg-deep border-l-2 border-v2-border-border-brand-strong pl-1.5 pr-2 font-medium rounded-l-none text-v2-text-text-strong shadow-sm": isActive,
                  "bg-blue-50/40 dark:bg-blue-950/20 border border-dashed border-blue-500/30 pl-1.5 pr-2 rounded-md": !isActive && isPending(),
                  "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base rounded-md px-2": !isActive && !isPending(),
                }}
                onClick={() => props.onSpaceClick(space)}
                onContextMenu={(e) => showSpaceMenu(e, space)}
              >
                <span
                  class="p-0.5 rounded hover:bg-v2-overlay-simple-overlay-hover cursor-pointer shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    toggleSpace(space.name)
                  }}
                >
                  <IconV2
                    name="outline-chevron-down"
                    class={`size-3 text-v2-text-text-muted transition-transform ${isExpanded() ? "" : "-rotate-90"}`}
                  />
                </span>
                <span class="flex-1 truncate text-12-regular text-v2-text-text-base">{space.name}</span>
                <Show when={space.type}>
                  <span class="rounded-full px-1.5 py-0.5 text-[9px] font-medium text-v2-text-text-muted bg-v2-background-bg-deep border border-v2-border-border-base scale-95 origin-right">
                    {space.type}
                  </span>
                </Show>
              </button>

              <Show when={isExpanded()}>
                <div class="ml-3">
                  <Show when={!loading()}
                    fallback={
                      <div class="py-1 text-10-regular text-v2-text-text-faint">{t("common.loading")}</div>
                    }
                  >
                    <For each={mergedSessions()}>
                      {(session) => renderSessionRow(session, space.name, sessions())}
                    </For>
                  </Show>
                </div>
              </Show>
            </div>
          )
        }}
      </For>

      <Show when={contextMenu()}>
        {(menu) => (
          <div
            class="fixed z-50 min-w-32 rounded-md border border-v2-border-border-base bg-v2-background-bg-base shadow-lg py-1"
            style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <For each={menu().items}>
              {(item) => (
                <button
                  type="button"
                  class="block w-full px-3 py-1.5 text-left text-12-regular text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                  onClick={() => {
                    item.action()
                    setContextMenu(null)
                  }}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  )
}
