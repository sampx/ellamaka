import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { For, Show, createSignal, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { useSessionStore } from "../session-store"
import { useWorkbenchState } from "../view"
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

  const [expandedSpaces, setExpandedSpaces] = createSignal<Set<string>>(new Set([props.activeSpaceName].filter(Boolean) as string[]))
  const [expandedProjects, setExpandedProjects] = createSignal<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = createSignal<ContextMenu | null>(null)
  const [overviewCache, setOverviewCache] = createStore<Record<string, SpaceOverview>>({})
  const [loading, setLoading] = createStore<Record<string, boolean>>({})

  function mergeSessions(serverSessions: OverviewSession[], spaceName: string): MergedSession[] {
    const localMap = new Map(sessionStore.spaceSessions(spaceName).map((s) => [s.id, s]))
    return serverSessions.map((ss) => {
      const local = localMap.get(ss.id)
      return {
        id: ss.id,
        title: ss.title || ss.id,
        status: local?.status ?? (ss.timeArchived ? "archived" as const : "idle" as const),
        boundPanelId: local?.boundPanelId,
      }
    })
  }

  onMount(() => {
    const handler = () => setContextMenu(null)
    document.addEventListener("click", handler)
    onCleanup(() => document.removeEventListener("click", handler))
  })

  // Auto-expand active space
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
    if (overviewCache[spaceName]) return
    setLoading(spaceName, true)
    try {
      const res = await sdk.client.wopalSpace.spaceOverview({ spaceName })
      setOverviewCache(spaceName, (res as any).data ?? { spaceName, spacePath: "", spaceRootSessionCount: 0, spaceRootSessions: [], projects: [] })
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
    const isArchived = session.status === "archived"
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: t("workbench.tree.rename"),
          action: () => {
            const newTitle = prompt(t("workbench.tree.rename"), session.title)
            if (newTitle && newTitle.trim()) {
              sessionStore.updateSession(session.id, { title: newTitle.trim() })
            }
          },
        },
        {
          label: isArchived ? t("workbench.tree.unarchive") : t("workbench.tree.archive"),
          action: () => {
            if (isArchived) {
              sessionStore.deleteSession(session.id)
              sessionStore.createSession(spaceName, projectPath, "chat", session.title)
            } else {
              sessionStore.archiveSession(session.id)
            }
            setOverviewCache(spaceName, undefined!)
          },
        },
        {
          label: t("workbench.tree.openInNewPanel"),
          action: () => {
            const space = props.spaces.find((s) => s.name === spaceName)
            if (!space) return
            const panelId = wb.addPanel(space.path)
            if (!panelId) {
              props.onStatusMessage(t("workbench.tree.noEmptyPanel"))
              return
            }
            wb.bindSessionToPanel(space.path, panelId, session.id)
            sessionStore.bindPanel(session.id, panelId)
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
          action: () => {
            sessionStore.createSession(spaceName, projectPath, "chat", t("workbench.tree.newSession"))
            setOverviewCache(spaceName, undefined!)
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
          e.dataTransfer!.setData("text/sessionId", session.id)
          e.dataTransfer!.setData("text/spaceName", spaceName)
        }}
        onClick={() => handleSessionClick(session.id)}
        onContextMenu={(e) => showSessionMenu(e, session, spaceName, projectPath)}
      >
        <span class={`size-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`} />
        <span class="flex-1 truncate">{session.title}</span>
      </button>
    )
  }

  function renderProject(project: OverviewProject, spaceName: string) {
    const projectPath = project.path
    const projectLabel = project.name || projectPath.split("/").pop() || projectPath
    const projectKey = `${spaceName}/${projectPath}`
    const isProjExpanded = () => expandedProjects().has(projectKey)

    const rootSessions = mergeSessions(project.rootSessions, spaceName)

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
            <For each={rootSessions}>
              {(session) => renderSessionRow(session, spaceName, projectPath)}
            </For>

            <For each={project.directories}>
              {(dir) => {
                const dirSessions = mergeSessions(dir.sessions, spaceName)
                return (
                  <div>
                    <div class="flex items-center gap-1 px-2 py-0.5 text-10-regular text-v2-text-text-faint">
                      <span class="truncate">{dir.path.split("/").pop() || dir.path}</span>
                      <span class="text-v2-text-text-faint/50">({dir.sessionCount})</span>
                    </div>
                    <div class="ml-2">
                      <For each={dirSessions}>
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
                const wtSessions = mergeSessions(wt.sessions, spaceName)
                return (
                  <div>
                    <div class="flex items-center gap-1 px-2 py-0.5 text-10-regular text-v2-text-text-faint">
                      <span class="truncate">{wt.worktreePath.split("/").pop() || wt.worktreePath}</span>
                      <Show when={wt.branch}>
                        <span class="text-v2-text-text-faint/50">({wt.branch})</span>
                      </Show>
                    </div>
                    <div class="ml-2">
                      <For each={wtSessions}>
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
          const isExpanded = () => expandedSpaces().has(space.name)

          // Trigger overview load when expanded
          createMemo(() => {
            if (isExpanded()) loadSpaceOverview(space.name)
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
                <Show
                  when={!spaceLoading()}
                  fallback={
                    <div class="ml-5 py-1 text-10-regular text-v2-text-text-faint">{t("common.loading")}</div>
                  }
                >
                  <div class="ml-3">
                    <Show when={overview()}>
                      {(ov) => {
                        const rootSessions = mergeSessions(ov().spaceRootSessions, space.name)
                        return (
                          <>
                            <For each={rootSessions}>
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
