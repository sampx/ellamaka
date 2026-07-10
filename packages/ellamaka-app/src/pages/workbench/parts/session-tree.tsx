import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { For, Show, createSignal, createMemo, createEffect, onCleanup, onMount, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { useSessionStore } from "../session-store"
import { useWorkbenchState } from "../view"
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

  function loadExpanded(): { spaces: string[]; projects: string[] } {
    try {
      const raw = localStorage.getItem(EXPAND_STORAGE_KEY)
      if (!raw) return { spaces: [], projects: [] }
      const parsed = JSON.parse(raw)
      return { spaces: parsed.spaces ?? [], projects: parsed.projects ?? [] }
    } catch {
      return { spaces: [], projects: [] }
    }
  }

  const saved = loadExpanded()
  const initialSpaces = new Set(saved.spaces)
  if (props.activeSpaceName) initialSpaces.add(props.activeSpaceName)

  const [expandedSpaces, setExpandedSpaces] = createSignal<Set<string>>(initialSpaces)
  const [expandedProjects, setExpandedProjects] = createSignal<Set<string>>(new Set(saved.projects))
  const [contextMenu, setContextMenu] = createSignal<ContextMenu | null>(null)
  const [overviewCache, setOverviewCache] = createStore<Record<string, SpaceOverview>>({})
  const [loading, setLoading] = createStore<Record<string, boolean>>({})
  const fetchVersions = new Map<string, number>()

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

  function mergeSessions(serverSessions: OverviewSession[]): MergedSession[] {
    return mergeSessionTreeSessions(serverSessions, isSessionBound)
  }

  function syncOverviewTitles(spaceName: string, overview: SpaceOverview) {
    const localSessions = sessionStore.spaceSessions(spaceName)
    const patches = getServerTitlePatches([
      ...overview.spaceRootSessions,
      ...overview.projects.flatMap((project) => [
        ...project.rootSessions,
        ...project.directories.flatMap((dir) => dir.sessions),
        ...project.worktrees.flatMap((worktree) => worktree.sessions),
      ]),
    ], localSessions)

    for (const patch of patches) {
      sessionStore.syncSessionReference(patch.id, { title: patch.title })
    }
  }

  onMount(() => {
    const handler = () => setContextMenu(null)
    document.addEventListener("click", handler)
    onCleanup(() => document.removeEventListener("click", handler))
  })

  // Persist expand state to localStorage
  createEffect(() => {
    const spaces = [...expandedSpaces()]
    const projects = [...expandedProjects()]
    try {
      localStorage.setItem(EXPAND_STORAGE_KEY, JSON.stringify({ spaces, projects }))
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

  async function loadSpaceOverview(spaceName: string) {
    const currentKey = sessionStore.refreshKey()
    const lastKey = fetchVersions.get(spaceName) ?? -1
    if (overviewCache[spaceName] && currentKey === lastKey) return
    fetchVersions.set(spaceName, currentKey)
    setLoading(spaceName, true)
    try {
      const res = await sdk.client.wopalSpace.spaceOverview({ spaceName })
      const next = (res as any).data ?? { spaceName, spacePath: "", spaceRootSessionCount: 0, spaceRootSessions: [], projects: [] }
      syncOverviewTitles(spaceName, next)
      const prev = overviewCache[spaceName]
      // Skip update if structurally identical — prevents tree flicker on session.updated
      if (prev && overviewStructurallyEqual(prev, next)) return
      setOverviewCache(spaceName, next)
    } catch {
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
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: t("workbench.tree.rename"),
          action: () => {
            const newTitle = prompt(t("workbench.tree.rename"), session.title)
            if (!newTitle || !newTitle.trim() || newTitle.trim() === session.title) return
            const trimmed = newTitle.trim()
            sessionStore.renameSession(session.id, trimmed)
            void sdk.client.session.update({ sessionID: session.id, title: trimmed }).catch(() => {})
          },
        },
        {
          label: t("workbench.tree.archive"),
          action: async () => {
            try {
              await sdk.client.session.update({
                sessionID: session.id,
                time: { archived: Date.now() },
              })
              for (const sp of Object.keys(wb.spaces)) {
                const space = wb.spaces[sp]
                if (!space) continue
                for (const panel of space.panels) {
                  if (panel.boundSessionId === session.id) {
                    wb.unbindSessionFromPanel(sp, panel.id)
                  }
                }
              }
              sessionStore.deleteSession(session.id)
              setOverviewCache(spaceName, undefined!)
            } catch (err) {
              console.error("Failed to archive session:", err)
            }
          },
        },
        {
          label: t("workbench.tree.openInNewPanel"),
          action: () => {
            const space = props.spaces.find((s) => s.name === spaceName)
            if (!space) return
            if (isSessionBound(session.id)) {
              props.onStatusMessage(t("workbench.panel.sessionAlreadyOpen"))
              return
            }
            // Ensure local reference exists (may be a server session)
            let localSession = sessionStore.getSession(session.id)
            if (!localSession) {
              localSession = sessionStore.ensureSessionReference(session.id, spaceName, projectPath, "chat", session.title)
            }
            const panelId = wb.addPanel(space.path)
            if (!panelId) {
              props.onStatusMessage(t("workbench.tree.noEmptyPanel"))
              return
            }
            sessionStore.bindPanel(session.id, panelId)
            wb.bindSessionToPanel(space.path, panelId, session.id)
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

  function statusDotClass(status: string) {
    if (status === "bound") return "bg-green-400"
    if (status === "archived") return "bg-v2-text-text-faint"
    return "bg-v2-icon-icon-muted"
  }

  function renderSessionRow(session: MergedSession, spaceName: string, projectPath: string) {
    return (
      <button
        type="button"
        class="group flex w-full items-center gap-2 rounded-md px-2 py-0.5 text-left text-11-regular text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base transition-colors"
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
        onClick={() => handleSessionClick(session.id)}
        onContextMenu={(e) => showSessionMenu(e, session, spaceName, projectPath)}
      >
        <Show
          when={session.status === "bound"}
          fallback={<span class={`size-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`} />}
        >
          <div class="size-2.5 rounded-[2px] bg-gradient-to-br from-v2-icon-icon-brand to-v2-icon-icon-accent shrink-0" />
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
                return (
                  <div>
                    <div class="flex items-center gap-1 px-2 py-0.5 text-10-regular text-v2-text-text-faint">
                      <span class="truncate">{dir.path.split("/").pop() || dir.path}</span>
                      <span class="text-v2-text-text-faint/50">({dir.sessionCount})</span>
                    </div>
                    <div class="ml-2">
                      <For each={dirSessions()}>
                        {(session) => renderSessionRow(session, spaceName, projectPath)}
                      </For>
                    </div>
                  </div>
                )
              }}
            </For>

            <For each={project.worktrees}>
              {(wt) => {
                if (wt.stale) return null
                const wtSessions = createMemo(() => mergeSessions(wt.sessions))
                return (
                  <div>
                    <div class="flex items-center gap-1 px-2 py-0.5 text-10-regular text-v2-text-text-faint">
                      <span class="truncate">{wt.worktreePath.split("/").pop() || wt.worktreePath}</span>
                      <Show when={wt.branch}>
                        <span class="text-v2-text-text-faint/50">({wt.branch})</span>
                      </Show>
                    </div>
                    <div class="ml-2">
                      <For each={wtSessions()}>
                        {(session) => renderSessionRow(session, spaceName, projectPath)}
                      </For>
                    </div>
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
    <div class="flex-1 overflow-y-auto px-1.5">
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
            void sessionStore.refreshKey()
            if (untrack(isExpanded)) {
              untrack(() => loadSpaceOverview(space.name))
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
              >
                <IconV2
                  name={isExpanded() ? "outline-chevron-down" : "outline-chevron-down"}
                  class={`size-3 shrink-0 text-v2-text-text-muted ${isExpanded() ? "" : "-rotate-90"}`}
                />
                <span class="flex-1 truncate text-12-regular text-v2-text-text-base">{space.name}</span>
                <Show when={space.type}>
                  <span class="rounded px-1 text-9-regular text-v2-text-text-muted bg-v2-background-bg-base">
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
