import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { For, Show, createSignal, createMemo, createEffect, onCleanup, onMount, untrack, batch } from "solid-js"
import { createStore } from "solid-js/store"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { useSessionStore } from "../session-store"
import { useWorkbenchState } from "../view-store"
import { setInvisibleSessionDragPreview } from "./session-tree-drag-preview"
import { getServerTitlePatches, mergeSessionTreeSessions } from "./session-tree-merge"
import type { WopalSpace } from "../space-store"

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
  boundPanelId?: string
}

type OverviewSession = {
  id: string
  title: string
  directory: string
  marker: "" | "directory" | "worktree"
  agent?: string
  timeCreated: number
  timeUpdated: number
  timeArchived?: number
}

type OverviewProject = {
  path: string
  displayPath: string
  name?: string
  vcs?: "git"
  sessionCount: number
  rootSessions: OverviewSession[]
  directories: { path: string; sessionCount: number; sessions: OverviewSession[] }[]
  worktrees: { worktreePath: string; branch?: string; stale: boolean; sessionCount: number; sessions: OverviewSession[] }[]
}

type SpaceOverview = {
  spaceName: string
  spacePath: string
  spaceRootSessionCount: number
  spaceRootSessions: OverviewSession[]
  projects: OverviewProject[]
}

export function SessionTree(props: {
  spaces: WopalSpace[]
  activeSpaceName: string | undefined
  onSpaceClick: (space: WopalSpace) => void
  onProjectClick: (spaceName: string, projectPath: string) => void
  onSessionClick: (sessionId: string) => void
  onStatusMessage: (msg: string) => void
}) {
  const sdk = useServerSDK()
  const language = useLanguage()
  const t = (k: string) => language.t(k)
  const sessionStore = useSessionStore()
  const wb = useWorkbenchState()

  const EXPAND_STORAGE_KEY = "workbench.tree.expanded"
  const PINNED_STORAGE_KEY = "workbench.tree.pinned"

  function loadExpanded(): { spaces: string[]; projects: string[]; dirs: string[] } {
    try {
      const raw = localStorage.getItem(EXPAND_STORAGE_KEY)
      if (!raw) return { spaces: [], projects: [], dirs: [] }
      const parsed = JSON.parse(raw)
      return {
        spaces: parsed.spaces ?? [],
        projects: parsed.projects ?? [],
        dirs: parsed.dirs ?? [],
      }
    } catch {
      return { spaces: [], projects: [], dirs: [] }
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
  const initialSpaces = new Set(saved.spaces)
  if (props.activeSpaceName) initialSpaces.add(props.activeSpaceName)

  const [expandedSpaces, setExpandedSpaces] = createSignal<Set<string>>(initialSpaces)
  const [expandedProjects, setExpandedProjects] = createSignal<Set<string>>(new Set(saved.projects))
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set(saved.dirs))
  const [pinnedSessions, setPinnedSessions] = createSignal<Set<string>>(new Set(loadPinned()))
  const [contextMenu, setContextMenu] = createSignal<ContextMenu | null>(null)
  const [overviewCache, setOverviewCache] = createStore<Record<string, SpaceOverview>>({})
  const [loading, setLoading] = createStore<Record<string, boolean>>({})
  const fetchVersions = new Map<string, number>()

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

    if (session.projectPath && session.spaceName !== "General") {
      const overview = overviewCache[session.spaceName]
      if (overview) {
        const matchingProject = overview.projects.find((proj) => {
          return session.projectPath === proj.path || session.projectPath.startsWith(proj.path + "/")
        })
        if (matchingProject) {
          const projKey = `${session.spaceName}/${matchingProject.path}`
          setExpandedProjects((prev) => {
            if (prev.has(projKey)) return prev
            const next = new Set(prev)
            next.add(projKey)
            return next
          })

          if (session.projectPath !== matchingProject.path) {
            const dirKey = `${session.spaceName}/${matchingProject.path}/${session.projectPath}`
            setExpandedDirs((prev) => {
              if (prev.has(dirKey)) return prev
              const next = new Set(prev)
              next.add(dirKey)
              return next
            })
          }
        }
      }
    }
  })

  // Shallow structural comparison — ignores timestamps to avoid unnecessary re-renders
  // when session.updated only bumped timeUpdated (e.g. during chat conversation).
  function overviewStructurallyEqual(a: SpaceOverview, b: SpaceOverview): boolean {
    if (a.spaceRootSessionCount !== b.spaceRootSessionCount) return false
    if (a.projects.length !== b.projects.length) return false
    if (!sessionListEqual(a.spaceRootSessions, b.spaceRootSessions)) return false
    for (let i = 0; i < a.projects.length; i++) {
      const ap = a.projects[i], bp = b.projects[i]
      if (ap.path !== bp.path || ap.sessionCount !== bp.sessionCount) return false
      if (ap.directories.length !== bp.directories.length) return false
      if (ap.worktrees.length !== bp.worktrees.length) return false
      if (!sessionListEqual(ap.rootSessions, bp.rootSessions)) return false
      for (let j = 0; j < ap.directories.length; j++) {
        const ad = ap.directories[j], bd = bp.directories[j]
        if (ad.path !== bd.path || ad.sessionCount !== bd.sessionCount) return false
        if (!sessionListEqual(ad.sessions, bd.sessions)) return false
      }
      for (let j = 0; j < ap.worktrees.length; j++) {
        const aw = ap.worktrees[j], bw = bp.worktrees[j]
        if (aw.worktreePath !== bw.worktreePath || aw.stale !== bw.stale || aw.sessionCount !== bw.sessionCount) return false
        if (!sessionListEqual(aw.sessions, bw.sessions)) return false
      }
    }
    return true
  }

  function sessionListEqual(a: OverviewSession[], b: OverviewSession[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      const as = a[i], bs = b[i]
      if (as.id !== bs.id || as.title !== bs.title || as.marker !== bs.marker) return false
      if ((as.timeArchived ? 1 : 0) !== (bs.timeArchived ? 1 : 0)) return false
    }
    return true
  }

  function isSessionBound(sessionId: string): boolean {
    for (const spacePath of Object.keys(wb.spaces)) {
      const space = wb.spaces[spacePath]
      if (space?.panels?.some((p) => p.boundSessionId === sessionId)) {
        return true
      }
    }
    return false
  }

  function getPanelBadge(sessionId: string): string | undefined {
    const activePath = wb.activeTab()?.path
    if (!activePath) return undefined
    const space = wb.spaces[activePath]
    if (!space?.panels) return undefined
    const idx = space.panels.findIndex((p) => p.boundSessionId === sessionId)
    if (idx !== -1) return `P${idx + 1}`

    for (const spPath of Object.keys(wb.spaces)) {
      if (spPath === activePath) continue
      const otherSpace = wb.spaces[spPath]
      const otherIdx = otherSpace?.panels?.findIndex((p) => p.boundSessionId === sessionId) ?? -1
      if (otherIdx !== -1) return `P${otherIdx + 1}`
    }
    return undefined
  }

  function mergeSessions(serverSessions: OverviewSession[]): MergedSession[] {
    const merged = mergeSessionTreeSessions(serverSessions, isSessionBound)
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

  function syncOverviewTitles(spaceName: string, overview: SpaceOverview) {
    const serverSessions = [
      ...overview.spaceRootSessions,
      ...overview.projects.flatMap((project) => [
        ...project.rootSessions,
        ...project.directories.flatMap((dir) => dir.sessions),
        ...project.worktrees.flatMap((worktree) => worktree.sessions),
      ]),
    ]

    batch(() => {
      for (const s of serverSessions) {
        sessionStore.ensureSessionReference(
          s.id,
          spaceName,
          s.directory,
          (s.agent === "tui" ? "tui" : "chat") as any,
          s.title,
        )
      }
    })
  }

  let treeContainerRef: HTMLDivElement | undefined

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

    onCleanup(() => {
      document.removeEventListener("click", handler)
    })
  })

  // Persist expand state and pinned state to localStorage
  createEffect(() => {
    const spaces = [...expandedSpaces()]
    const projects = [...expandedProjects()]
    const dirs = [...expandedDirs()]
    try {
      localStorage.setItem(EXPAND_STORAGE_KEY, JSON.stringify({ spaces, projects, dirs }))
    } catch {}
  })

  createEffect(() => {
    const pinned = [...pinnedSessions()]
    try {
      localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinned))
    } catch {}
  })

  const activeName = () => props.activeSpaceName
  createMemo(() => {
    const name = activeName()
    if (!name) return
    setExpandedSpaces((prev) => {
      if (prev.has(name)) return prev
      const next = new Set(prev)
      next.add(name)
      return next
    })
  })

  function toggleSpace(spaceName: string) {
    setExpandedSpaces((prev) => {
      const next = new Set(prev)
      if (next.has(spaceName)) next.delete(spaceName)
      else next.add(spaceName)
      return next
    })
  }

  function toggleProject(key: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleDirectory(key: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function loadSpaceOverview(spaceName: string, force = false) {
    const currentKey = sessionStore.refreshKey()
    const lastKey = fetchVersions.get(spaceName) ?? -1
    if (!force && overviewCache[spaceName] && currentKey === lastKey) return
    fetchVersions.set(spaceName, currentKey)
    setLoading(spaceName, true)

    if (spaceName === "General") {
      try {
        const res = await sdk.client.wopalSpace.nonSpaceOverview()
        const orphanDirs = (res as any).data?.orphanDirectories || []

        const projects: OverviewProject[] = orphanDirs.map((od: any) => {
          const name = od.path.split("/").pop() || od.path
          return {
            path: od.path,
            displayPath: od.path,
            name: name,
            sessionCount: od.sessions.length,
            rootSessions: od.sessions.map((s: any) => ({
              id: s.id,
              title: s.title,
              directory: s.directory,
              marker: s.marker || "",
              timeCreated: s.timeCreated,
              timeUpdated: s.timeUpdated,
              timeArchived: s.timeArchived,
            })),
            directories: [],
            worktrees: [],
          };
        })

        const next: SpaceOverview = {
          spaceName: "General",
          spacePath: "",
          spaceRootSessionCount: 0,
          spaceRootSessions: [],
          projects: projects,
        }
        syncOverviewTitles("General", next)
        setOverviewCache("General", next)
      } catch (e) {
        console.error("loadSpaceOverview General error:", e)
        setOverviewCache("General", { spaceName: "General", spacePath: "", spaceRootSessionCount: 0, spaceRootSessions: [], projects: [] })
      } finally {
        setLoading("General", false)
      }
      return
    }

    try {
      const res = await sdk.client.wopalSpace.spaceOverview({ spaceName })
      const next = (res as any).data ?? { spaceName, spacePath: "", spaceRootSessionCount: 0, spaceRootSessions: [], projects: [] }
      syncOverviewTitles(spaceName, next)
      const prev = overviewCache[spaceName]
      // Skip update if structurally identical — prevents tree flicker on session.updated
      if (prev && overviewStructurallyEqual(prev, next)) return
      setOverviewCache(spaceName, next)
    } catch (e) {
      console.error("loadSpaceOverview Physical error:", e)
      setOverviewCache(spaceName, { spaceName, spacePath: "", spaceRootSessionCount: 0, spaceRootSessions: [], projects: [] })
    } finally {
      setLoading(spaceName, false)
    }
  }

  function handleSpaceClick(space: WopalSpace) {
    if (space.name === props.activeSpaceName) {
      toggleSpace(space.name)
      return
    }
    props.onSpaceClick(space)
  }

  function handleProjectClick(spaceName: string, projectPath: string) {
    const key = `${spaceName}/${projectPath}`
    toggleProject(key)
    props.onProjectClick(spaceName, projectPath)
  }

  function handleSessionClick(sessionId: string) {
    props.onSessionClick(sessionId)
  }

  function showSessionMenu(e: MouseEvent, session: MergedSession, spaceName: string, projectPath: string) {
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
            const newTitle = prompt(t("workbench.tree.rename"), session.title)
            if (newTitle === null) return
            const trimmed = newTitle.trim()
            if (trimmed) {
              sessionStore.renameSession(session.id, trimmed)
              void sdk.client.session.update({ sessionID: session.id, title: trimmed }).catch(() => {})
            }
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
          action: async () => {
            const ok = confirm(t("workbench.tree.deleteConfirm"))
            if (!ok) return
            try {
              await sdk.client.session.delete({ sessionID: session.id, directory: projectPath })
              sessionStore.deleteSession(session.id)
              wb.unbindSessionGlobal(session.id)
            } catch (err) {
              console.error("Failed to delete session:", err)
            }
          },
        },
      ],
    })
  }

  function showProjectMenu(e: MouseEvent, spaceName: string, projectPath: string) {
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
              const res = await sdk.client.session.create({ directory: projectPath })
              const serverSession = (res as any).data
              if (!serverSession?.id) return
              const title = serverSession.title ?? t("workbench.tree.newSession")
              sessionStore.ensureSessionReference(serverSession.id, spaceName, projectPath, "chat", title)
              sessionStore.triggerRefresh()
            } catch (err) {
              console.error("Failed to create session:", err)
            }
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
              let targetDir = space.path
              
              if (space.name === "General") {
                const pathRes = await sdk.client.path.get()
                const wopalHome = pathRes.data?.wopalHome || `${pathRes.data?.home || ""}/.wopal`
                const now = new Date()
                const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`
                targetDir = `${wopalHome}/general_tasks/${dateStr}`
              }

              const res = await sdk.client.session.create({ directory: targetDir })
              const serverSession = (res as any).data
              if (!serverSession?.id) return
              const title = serverSession.title ?? t("workbench.tree.newSession")
              sessionStore.ensureSessionReference(serverSession.id, space.name, targetDir, "chat", title)
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

  function renderSessionRow(session: MergedSession, spaceName: string, projectPath: string) {
    const handleSessionClick = () => {
      const badge = getPanelBadge(session.id)
      if (badge) {
        let boundSpacePath: string | undefined
        let boundPanelId: string | undefined

        for (const spPath of Object.keys(wb.spaces)) {
          const spaceState = wb.spaces[spPath]
          const p = spaceState?.panels?.find((panel) => panel.boundSessionId === session.id)
          if (p) {
            boundSpacePath = spPath
            boundPanelId = p.id
            break
          }
        }

        if (boundSpacePath && boundPanelId) {
          const targetSpace = props.spaces.find((s) => s.path === boundSpacePath)
          if (targetSpace && wb.activeSpaceName !== targetSpace.name) {
            wb.setActive(targetSpace.name)
          }
          wb.setActivePanel(boundSpacePath, boundPanelId)
        }
        wb.setStatusMessage(`已激活绑定了该会话的面板 ${badge}`)
      } else {
        wb.setStatusMessage("提示：双击会话或拖拽会话到面板中即可在工作台打开")
      }
      props.onSessionClick(session.id)
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

      // Auto-open or auto-switch space tab if it is not currently open/active
      if (!wb.tabs.some((t) => t.name === spaceName)) {
        wb.openTab(targetSpace)
      } else if (wb.activeSpaceName !== spaceName) {
        wb.setActive(spaceName)
      }

      const space = wb.spaces[targetSpacePath]
      if (!space || !space.panels || space.panels.length === 0) return

      let targetPanel = space.panels.find((p) => p.slotState === "empty")

      if (!targetPanel && space.panels.length < 3) {
        const newPanelId = wb.addPanel(targetSpacePath)
        if (newPanelId) {
          // Fetch updated state after adding panel
          const updatedSpace = wb.spaces[targetSpacePath]
          targetPanel = updatedSpace?.panels?.find((p) => p.id === newPanelId)
        }
      }

      if (!targetPanel) {
        const activeId = space.activePanelID
        targetPanel = space.panels.find((p) => p.id === activeId) || space.panels[0]
        
        const isFirst = !activeId || targetPanel.id === space.panels[0].id
        const confirmMsg = isFirst
          ? "当前所有面板已满且未选择活动面板，是否覆盖第一个面板以打开此会话？"
          : "当前面板已满，是否覆盖当前活动面板以打开此会话？"
        
        const ok = confirm(confirmMsg)
        if (!ok) return
      }

      if (targetPanel) {
        let localSession = sessionStore.getSession(session.id)
        if (!localSession) {
          localSession = sessionStore.ensureSessionReference(session.id, spaceName, projectPath, "chat", session.title)
        }
        wb.bindSessionToPanel(targetSpacePath, targetPanel.id, session.id)
        wb.setPanelViewMode(targetSpacePath, targetPanel.id, "chat")
        wb.setActivePanel(targetSpacePath, targetPanel.id)
        
        const badge = getPanelBadge(session.id)
        wb.setStatusMessage(`已在面板 ${badge || ""} 中装载会话`)
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
          dataTransfer.setData("text/projectPath", projectPath)
          dataTransfer.setData("text/sessionTitle", session.title)
          setInvisibleSessionDragPreview(dataTransfer)
        }}
        onClick={handleSessionClick}
        onDblClick={handleSessionDblClick}
        onContextMenu={(e) => showSessionMenu(e, session, spaceName, projectPath)}
      >
        <Show
          when={getPanelBadge(session.id)}
          fallback={
            <Show
              when={pinnedSessions().has(session.id)}
              fallback={<span class={`size-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`} />}
            >
              <svg class="size-3 shrink-0 text-v2-icon-icon-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="17" x2="12" y2="22"></line>
                <path d="M5 17h14v-1.76a2 2 0 0 0-.44-1.24l-2.78-3.55A2 2 0 0 1 15 9.24V5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v4.24c0 .43-.14.85-.4 1.21L5.8 13.97A2 2 0 0 0 5 15.24V17z"></path>
              </svg>
            </Show>
          }
        >
          {(badge) => (
            <span class="flex items-center justify-center shrink-0 rounded-full px-1 text-[9px] font-bold text-white bg-v2-icon-icon-brand leading-none min-w-[18px] h-3.5 scale-90 select-none">
              {badge()}
            </span>
          )}
        </Show>
        <span class="flex-1 truncate">{session.title}</span>
      </button>
    )
  }

  function renderProject(project: OverviewProject, spaceName: string) {
    const projectPath = project.path
    const projectLabel = project.name || projectPath.split("/").pop() || projectPath
    const projectKey = `${spaceName}/${projectPath}`
    const isProjExpanded = () => expandedProjects().has(projectKey)

    const rootSessions = createMemo(() => mergeSessions(project.rootSessions))

    return (
      <div>
        <button
          type="button"
          class="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-11-regular text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base transition-colors"
          onClick={() => handleProjectClick(spaceName, projectPath)}
          onContextMenu={(e) => showProjectMenu(e, spaceName, projectPath)}
        >
          <IconV2
            name={isProjExpanded() ? "outline-chevron-down" : "outline-chevron-down"}
            class={`size-2.5 shrink-0 ${isProjExpanded() ? "" : "-rotate-90"}`}
          />
          <span class="flex-1 truncate">{projectLabel}</span>
          <Show when={project.vcs === "git"}>
            <span class="text-9-regular text-v2-text-text-faint">git</span>
          </Show>
        </button>

        <Show when={isProjExpanded()}>
          <div class="ml-4">
            <For each={rootSessions()}>
              {(session) => renderSessionRow(session, spaceName, projectPath)}
            </For>

            <For each={project.directories}>
              {(dir) => {
                const dirSessions = createMemo(() => mergeSessions(dir.sessions))
                const dirKey = `${spaceName}/${projectPath}/${dir.path}`
                const isDirExpanded = () => expandedDirs().has(dirKey)
                return (
                  <div>
                    <button
                      type="button"
                      class="group flex w-full items-center gap-1 px-2 py-0.5 text-left text-10-regular text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base rounded-md transition-colors"
                      onClick={() => toggleDirectory(dirKey)}
                    >
                      <IconV2
                        name={isDirExpanded() ? "outline-chevron-down" : "outline-chevron-down"}
                        class={`size-2 shrink-0 ${isDirExpanded() ? "" : "-rotate-90"}`}
                      />
                      <span class="truncate">{dir.path.split("/").pop() || dir.path}</span>
                      <span class="text-v2-text-text-faint/50">({dir.sessionCount})</span>
                    </button>
                    <Show when={isDirExpanded()}>
                      <div class="ml-3 border-l border-v2-border-border-base/20 pl-1.5">
                        <For each={dirSessions()}>
                          {(session) => renderSessionRow(session, spaceName, projectPath)}
                        </For>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>

            <For each={project.worktrees}>
              {(wt) => {
                if (wt.stale) return null
                const wtSessions = createMemo(() => mergeSessions(wt.sessions))
                const wtKey = `${spaceName}/${projectPath}/wt/${wt.worktreePath}`
                const isWtExpanded = () => expandedDirs().has(wtKey)
                return (
                  <div>
                    <button
                      type="button"
                      class="group flex w-full items-center gap-1 px-2 py-0.5 text-left text-10-regular text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base rounded-md transition-colors"
                      onClick={() => toggleDirectory(wtKey)}
                    >
                      <IconV2
                        name={isWtExpanded() ? "outline-chevron-down" : "outline-chevron-down"}
                        class={`size-2 shrink-0 ${isWtExpanded() ? "" : "-rotate-90"}`}
                      />
                      <span class="truncate">{wt.worktreePath.split("/").pop() || wt.worktreePath}</span>
                      <Show when={wt.branch}>
                        <span class="text-v2-text-text-faint/50">({wt.branch})</span>
                      </Show>
                    </button>
                    <Show when={isWtExpanded()}>
                      <div class="ml-3 border-l border-v2-border-border-base/20 pl-1.5">
                        <For each={wtSessions()}>
                          {(session) => renderSessionRow(session, spaceName, projectPath)}
                        </For>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </div>
    )
  }

  return (
    <div
      ref={treeContainerRef}
      class="flex-1 overflow-y-auto px-1.5"
      onScroll={(e) => sessionStorage.setItem("workbench.tree.scrollTop", String(e.currentTarget.scrollTop))}
    >
      <For each={props.spaces}>
        {(space) => {
          const isActive = space.name === props.activeSpaceName
          const isExpanded = createMemo(() => expandedSpaces().has(space.name))

          // Trigger overview load only when expanded status flips from false to true and we do not have cached overview data
          createEffect(() => {
            if (isExpanded() && !overview()) {
              untrack(() => loadSpaceOverview(space.name))
            }
          })

          // Trigger overview load when session store requires a refresh (e.g. session created/deleted)
          createEffect(() => {
            const localSessionIdsStr = (sessionStore.spaceSessions(space.name) || []).map((s) => s.id).join(",")
            void localSessionIdsStr
            if (untrack(isExpanded)) {
              untrack(() => loadSpaceOverview(space.name))
            }
          })

          // Trigger overview load when user manually clicks refresh button
          createEffect(() => {
            const ver = wb.refreshVersion
            if (ver > 0 && untrack(isExpanded)) {
              untrack(() => loadSpaceOverview(space.name, true))
            }
          })

          const overview = () => overviewCache[space.name]
          const spaceLoading = () => loading[space.name] ?? false

          return (
            <div>
              <button
                type="button"
                class={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                  isActive
                    ? "bg-v2-overlay-simple-overlay-hover"
                    : "hover:bg-v2-overlay-simple-overlay-hover"
                }`}
                onClick={() => handleSpaceClick(space)}
                onContextMenu={(e) => showSpaceMenu(e, space)}
              >
                <IconV2
                  name={isExpanded() ? "outline-chevron-down" : "outline-chevron-down"}
                  class={`size-3 shrink-0 text-v2-text-text-muted ${isExpanded() ? "" : "-rotate-90"}`}
                />
                <span class="flex-1 truncate text-12-regular text-v2-text-text-base">{space.name}</span>
                <Show when={space.type}>
                  <span class="rounded-full px-1.5 py-0.5 text-[9px] font-medium text-v2-text-text-muted bg-v2-background-bg-deep border border-v2-border-border-base scale-95 origin-right">
                    {space.type}
                  </span>
                </Show>
              </button>

              <Show when={isExpanded()}>
                <div class="ml-3">
                  <Show
                    when={overview()}
                    fallback={
                      <Show when={spaceLoading()}>
                        <div class="py-1 text-10-regular text-v2-text-text-faint">{t("common.loading")}</div>
                      </Show>
                    }
                  >
                    {(ov) => {
                      const rootSessions = createMemo(() => mergeSessions(ov().spaceRootSessions))
                      return (
                        <>
                          <For each={rootSessions()}>
                            {(session) => renderSessionRow(session, space.name, space.path)}
                          </For>
                          <For each={ov().projects}>
                            {(project) => renderProject(project, space.name)}
                          </For>
                        </>
                      )
                    }}
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
