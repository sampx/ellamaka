import { For, Show, createSignal, createMemo, createEffect, onCleanup, onMount, batch } from "solid-js"
import { createStore } from "solid-js/store"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { useSessionProjectionWriter, useSessionStore } from "../session-store"
import { useWorkbenchState } from "../view-store"
import { mergeSessionTreeSessions } from "./session-tree-merge"
import type { WopalSpace } from "../space-store"
import { useWorkbenchActions } from "../workbench-actions"
import { scopeFromTab, GENERAL_SCOPE_NAME } from "../workbench-scope"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { reportWorkbenchError } from "../workbench-error"
import { DialogRenameSession, DialogDeleteSession } from "./session-tree-dialogs"
import { createSessionGroupsLoader, fetchSessionGroups, getPanelBadge, type GroupSession, type SessionGroup } from "./session-tree-services"
import { SessionTreeSpace } from "./session-tree-space"

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
  const t: typeof language.t = (key, params) => language.t(key, params)
  const sessionStore = useSessionStore()
  const projection = useSessionProjectionWriter()
  const wb = useWorkbenchState()
  const actions = useWorkbenchActions()
  const dialog = useDialog()



  const EXPAND_STORAGE_KEY = "workbench.tree.expanded"
  const PINNED_STORAGE_KEY = "workbench.tree.pinned"

  function loadExpanded(): string[] {
    try {
      const raw = localStorage.getItem(EXPAND_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return parsed.spaces ?? []
    } catch (e) {
      reportWorkbenchError("load expanded", e)
      return []
    }
  }

  function loadPinned(): string[] {
    try {
      const raw = localStorage.getItem(PINNED_STORAGE_KEY)
      if (!raw) return []
      return JSON.parse(raw) ?? []
    } catch (e) {
      reportWorkbenchError("load pinned", e)
      return []
    }
  }

  const saved = loadExpanded()
  const initialSpaces = new Set(saved)
  if (props.activeSpaceName) initialSpaces.add(props.activeSpaceName)

  const [expandedSpaces, setExpandedSpaces] = createSignal(initialSpaces)
  const [pinnedSessions, setPinnedSessions] = createSignal(new Set(loadPinned()))
  const [selectedSessionId, setSelectedSessionId] = createSignal<string | undefined>(undefined)

  createEffect(() => {
    const activeId = activeSessionId()
    if (activeId) {
      setSelectedSessionId(activeId)
    }
  })

  createEffect(() => {
    const activeId = selectedSessionId()
    if (!activeId) {
      wb.setPersistentHint("")
      return
    }

    let dirHealth = "healthy"
    for (const space of props.spaces) {
      const sData = getSessionsForSpace(space.name).find((s) => s.id === activeId)
      if (sData) {
        dirHealth = space.name === GENERAL_SCOPE_NAME ? "healthy" : (sData.directoryHealth ?? "healthy")
        break
      }
    }

    const badge = getPanelBadge(wb, activeId)
    if (badge) {
      wb.setPersistentHint(t("workbench.status.panelActivated", { badge }))
    } else {
      if (dirHealth !== "healthy") {
        wb.setPersistentHint(t("workbench.status.dirHealthWarning"))
      } else {
        wb.setPersistentHint(t("workbench.status.sessionReadyHint"))
      }
    }
  })

  const [contextMenu, setContextMenu] = createSignal<ContextMenu | null>(null)
  const [allGroups, setAllGroups] = createStore<SessionGroup[]>([])
  const [loading, setLoading] = createSignal(false)
  let fetchVersion = -1

  // O22: Row ref map for single scroll effect
  const rowRefs = new Map<string, HTMLButtonElement>()
  function registerRowRef(sessionId: string, el: HTMLButtonElement | null) {
    if (el) rowRefs.set(sessionId, el)
    else rowRefs.delete(sessionId)
  }

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

  // O22: Single scroll effect replacing per-row createEffect
  createEffect(() => {
    const id = activeSessionId()
    if (!id) return
    const el = rowRefs.get(id)
    if (!el) return
    const scrollTimer = setTimeout(() => {
      if (activeSessionId() !== id) return
      el.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }, 150)
    onCleanup(() => clearTimeout(scrollTimer))
  })

  // O8: Refresh coordinator — debounces multiple refresh sources into a single load
  const [refreshTick, setRefreshTick] = createSignal(0)
  let refreshForce = false
  function triggerRefresh(force = false) {
    if (force) refreshForce = true
    setRefreshTick((t) => t + 1)
  }

  let refreshDebounce: ReturnType<typeof setTimeout> | undefined
  const loadGroups = createSessionGroupsLoader({
    fetch: () => fetchSessionGroups(sdk),
    commit: (groups) => setAllGroups(groups),
    setLoading,
    onError: (error) => {
      reportWorkbenchError("load session groups", error)
      setAllGroups([])
    },
  })
  createEffect(() => {
    void sessionStore.refreshKey()
    refreshTick()
    wb.refreshVersion

    if (refreshDebounce) clearTimeout(refreshDebounce)
    refreshDebounce = setTimeout(() => {
      void loadSessionGroups(refreshForce)
      refreshForce = false
    }, 300)

    onCleanup(() => {
      if (refreshDebounce) clearTimeout(refreshDebounce)
    })
  })

  function isSessionBound(sessionId: string): boolean {
    return wb.findSessionBinding(sessionId) !== undefined
  }

  function getSessionsForSpace(spaceName: string): GroupSession[] {
    if (spaceName === GENERAL_SCOPE_NAME) {
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
      title: sessionStore.getSession(s.id)?.title ?? s.title,
    }))
    const merged = mergeSessionTreeSessions(simplified, isSessionBound, Object.values(sessionStore.sessions()).flat())
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
        projection.upsert({
          id: s.id,
          spaceName,
          projectPath: s.directory,
          type: s.agent === "tui" ? "tui" : "chat",
          title: s.title,
          directoryHealth: s.directoryHealth,
          createdAt: s.timeCreated,
          lastActiveAt: s.timeUpdated,
        })
      }
    })
  }

  createEffect(() => {
    for (const space of props.spaces) {
      syncGroupTitles(space.name, getSessionsForSpace(space.name))
    }
  })

  let treeContainerRef: HTMLDivElement | undefined
  let scrollTimeout: ReturnType<typeof setTimeout> | undefined

  const handleScroll = (e: Event & { currentTarget: HTMLDivElement }) => {
    const target = e.currentTarget
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
        triggerRefresh()
      }
    }, VISIBLE_REFRESH_MS)

    // Refresh tree when page becomes visible again (D-04)
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        triggerRefresh(true)
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
    } catch (e) {
      reportWorkbenchError("persist expanded", e)
    }
  })

  createEffect(() => {
    const pinned = [...pinnedSessions()]
    try {
      localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinned))
    } catch (e) {
      reportWorkbenchError("persist pinned", e)
    }
  })

  function toggleSpace(spaceName: string) {
    setExpandedSpaces((prev) => {
      const next = new Set(prev)
      if (next.has(spaceName)) next.delete(spaceName)
      else next.add(spaceName)
      return next
    })
  }

  function handleSpaceRowClick(space: WopalSpace) {
    setSelectedSessionId(undefined)
    if (space.name === props.activeSpaceName) {
      toggleSpace(space.name)
      return
    }
    setExpandedSpaces((prev) => {
      const next = new Set(prev)
      next.add(space.name)
      return next
    })
    props.onSpaceClick(space)
  }

  async function loadSessionGroups(force = false) {
    const currentKey = sessionStore.refreshKey()
    if (!force && allGroups.length > 0 && currentKey === fetchVersion) return
    fetchVersion = currentKey
    await loadGroups()
  }

  function showSessionMenu(e: MouseEvent, session: MergedSession, spaceName: string, sessionData: GroupSession) {
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
            void dialog.show(() => (
              <DialogRenameSession
                currentTitle={session.title}
                onRename={async (title) => {
                  const targetSpace = props.spaces.find((space) => space.name === spaceName)
                  if (targetSpace) {
                    await actions.renameSession({
                      scope: scopeFromTab(targetSpace),
                      sessionID: session.id,
                      directory: sessionData.directory,
                      title,
                    })
                  }
                }}
              />
            ))
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
            void dialog.show(() => (
              <DialogDeleteSession
                sessionTitle={session.title}
                onDelete={async () => {
                  const targetSpace = props.spaces.find((space) => space.name === spaceName)
                  if (!targetSpace) return
                  await actions.deleteSession({
                    scope: scopeFromTab(targetSpace),
                    sessionID: session.id,
                    directory: sessionData.directory,
                  })
                }}
              />
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
              if (wb.activeSpaceName !== space.name) {
                wb.setActive(space.name)
              }

              wb.ensureSpace(space.path)
              const targetSpaceState = wb.spaces[space.path]
              if (!targetSpaceState) return
              const scope = scopeFromTab(space)
              let targetPanel = targetSpaceState.panels.find((panel) => panel.slotState === "empty")
              if (!targetPanel && targetSpaceState.panels.length < 3) {
                const newPanelID = actions.addPanel(scope)
                if (newPanelID) {
                  targetPanel = wb.spaceState(space.path)?.panels.find((panel) => panel.id === newPanelID)
                }
              }
              if (targetPanel) await actions.createSession({ scope, panelID: targetPanel.id })
            } catch (err) {
              reportWorkbenchError("create session", err)
            }
          },
        },
      ],
    })
  }

  return (
    <div
      ref={treeContainerRef}
      class="flex-1 overflow-y-auto px-1.5"
      onScroll={handleScroll}
    >
      <For each={props.spaces}>
        {(space) => (
          <SessionTreeSpace
            space={space}
            isActive={space.name === props.activeSpaceName}
            isPending={props.pendingSpacePath !== undefined && props.pendingSpacePath === space.path}
            expandedSpaces={expandedSpaces}
            loading={loading}
            spaces={props.spaces}
            activeSessionId={activeSessionId}
            pinnedSessions={pinnedSessions}
            onSpaceClick={handleSpaceRowClick}
            onSessionClick={props.onSessionClick}
            onToggleSpace={toggleSpace}
            onSpaceContextMenu={showSpaceMenu}
            onSessionContextMenu={showSessionMenu}
            setSelectedSessionId={setSelectedSessionId}
            getSessionsForSpace={getSessionsForSpace}
            mergeSessions={mergeSessions}
            registerRowRef={registerRowRef}
            t={t}
          />
        )}
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
