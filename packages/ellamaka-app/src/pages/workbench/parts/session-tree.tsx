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
  const [projectCache, setProjectCache] = createStore<Record<string, any[]>>({})
  const [sessionCache, setSessionCache] = createStore<Record<string, MergedSession[]>>({})
  const [loading, setLoading] = createStore<Record<string, boolean>>({})

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

  async function loadProjects(spacePath: string) {
    if (projectCache[spacePath]) return
    setLoading(spacePath, true)
    try {
      const res = await sdk.client.project.list({ directory: spacePath })
      setProjectCache(spacePath, (res as any).data ?? [])
    } catch {
      setProjectCache(spacePath, [])
    } finally {
      setLoading(spacePath, false)
    }
  }

  async function loadSessions(spaceName: string, projectPath: string) {
    const key = `${spaceName}::${projectPath}`
    if (sessionCache[key]) return
    setLoading(key, true)
    try {
      const res = await sdk.client.session.list({ directory: projectPath })
      const serverSessions = (res as any).data ?? []
      const localSessions = sessionStore.spaceSessions(spaceName)
      const localMap = new Map(localSessions.map((s) => [s.id, s]))
      const merged: MergedSession[] = serverSessions.map((ss: any) => {
        const local = localMap.get(ss.id)
        return {
          id: ss.id,
          title: ss.title || ss.id,
          status: local?.status ?? (ss.time?.archived ? "archived" as const : "idle" as const),
          boundPanelId: local?.boundPanelId,
        }
      })
      setSessionCache(key, merged)
    } catch {
      setSessionCache(key, [])
    } finally {
      setLoading(key, false)
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
            // Invalidate session cache
            const key = `${spaceName}::${projectPath}`
            setSessionCache(key, undefined!)
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
            const key = `${spaceName}::${projectPath}`
            setSessionCache(key, undefined!)
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

  return (
    <div class="flex-1 overflow-y-auto px-1.5">
      <For each={props.spaces}>
        {(space) => {
          const isActive = space.name === props.activeSpaceName
          const isExpanded = () => expandedSpaces().has(space.name)

          // Trigger project load when expanded
          createMemo(() => {
            if (isExpanded()) loadProjects(space.path)
          })

          const projects = () => projectCache[space.path] ?? []
          const spaceLoading = () => loading[space.path] ?? false

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
                  name={isExpanded() ? "chevron-down" : "chevron-right"}
                  class="size-3 shrink-0 text-v2-text-text-muted"
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
                    <For each={projects()}>
                      {(project: any) => {
                        const projectPath = project.worktree || project.id
                        const projectLabel = project.name || projectPath.split("/").pop() || projectPath
                        const projectKey = `${space.name}/${projectPath}`
                        const isProjExpanded = () => expandedProjects().has(projectKey)

                        createMemo(() => {
                          if (isProjExpanded()) loadSessions(space.name, projectPath)
                        })

                        const sessions = () => sessionCache[`${space.name}::${projectPath}`] ?? []
                        const sessLoading = () => loading[`${space.name}::${projectPath}`] ?? false

                        return (
                          <div>
                            <button
                              type="button"
                              class="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-11-regular text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base transition-colors"
                              onClick={() => handleProjectClick(space.name, projectPath)}
                              onContextMenu={(e) => showProjectMenu(e, space.name, projectPath)}
                            >
                              <IconV2
                                name={isProjExpanded() ? "chevron-down" : "chevron-right"}
                                class="size-2.5 shrink-0"
                              />
                              <IconV2 name="folder" class="size-3 shrink-0" />
                              <span class="flex-1 truncate">{projectLabel}</span>
                            </button>

                            <Show when={isProjExpanded()}>
                              <Show
                                when={!sessLoading()}
                                fallback={
                                  <div class="ml-6 py-1 text-10-regular text-v2-text-text-faint">{t("common.loading")}</div>
                                }
                              >
                                <div class="ml-4">
                                  <For each={sessions()}>
                                    {(session) => (
                                      <button
                                        type="button"
                                        class="group flex w-full items-center gap-2 rounded-md px-2 py-0.5 text-left text-11-regular text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base transition-colors"
                                        onClick={() => handleSessionClick(session.id)}
                                        onContextMenu={(e) => showSessionMenu(e, session, space.name, projectPath)}
                                      >
                                        <span class={`size-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`} />
                                        <span class="flex-1 truncate">{session.title}</span>
                                      </button>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </Show>
                          </div>
                        )
                      }}
                    </For>
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
