import { createSignal, createResource, Show, For, batch } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { useSpaceStore } from "../space-store"
import { useSessionStore, type SessionType } from "../session-store"
import { useWorkbenchState } from "../view"
import type { WorkbenchPanel } from "../view"

type DirectoryEntry = {
  path: string
  displayPath: string
  isGitRepo: boolean
}

export function PanelLoader(props: {
  panel: WorkbenchPanel
  prefill?: { spaceName?: string; projectPath?: string }
}) {
  const sdk = useServerSDK()
  const spaceStore = useSpaceStore()
  const sessionStore = useSessionStore()
  const wb = useWorkbenchState()

  const [selectedSpace, setSelectedSpace] = createSignal(
    props.prefill?.spaceName ?? spaceStore.activeTab()?.name ?? "",
  )
  const [selectedProject, setSelectedProject] = createSignal(props.prefill?.projectPath ?? "")
  const [sessionType, setSessionType] = createSignal<SessionType>("chat")
  const [searchQuery, setSearchQuery] = createSignal("")

  const spacePath = () => spaceStore.spaces().find((s) => s.name === selectedSpace())?.path ?? "/"

  const [recentDirs] = createResource(
    () => selectedSpace(),
    async (spaceName) => {
      if (!spaceName) return [] as DirectoryEntry[]
      const res = await sdk.client.wopalSpace.recentDirectories({ spaceName })
      return res.data?.directories ?? []
    },
  )

  const [searchDirs] = createResource(
    () => ({ space: selectedSpace(), query: searchQuery() }),
    async ({ space, query }) => {
      if (!space || !query) return [] as DirectoryEntry[]
      const res = await sdk.client.wopalSpace.searchDirectories({ spaceName: space, query })
      return res.data?.directories ?? []
    },
  )

  const projectOptions = () => {
    if (searchQuery()) return searchDirs() ?? []
    return recentDirs() ?? []
  }

  const handleStartSession = () => {
    const space = selectedSpace()
    const project = selectedProject()
    if (!space || !project) return
    const title = project.split("/").pop() ?? project
    batch(() => {
      const session = sessionStore.createSession(space, project, sessionType(), `${title} ${sessionType()}`)
      wb.bindSessionToPanel(spacePath(), props.panel.id, session.id)
    })
  }

  const handleQuickTerminal = () => {
    if (!selectedSpace()) return
    wb.openTerminalInPanel(spacePath(), props.panel.id, spacePath())
  }

  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 px-6 text-center bg-v2-background-bg-base">
      {/* Space selector */}
      <div class="flex flex-col gap-1 w-full max-w-xs">
        <label class="text-11-medium text-v2-text-text-muted text-left">Space</label>
        <select
          class="w-full px-2.5 py-1.5 rounded-md bg-v2-background-bg-deep border border-v2-border-border-base text-12-regular text-v2-text-text-base cursor-pointer"
          value={selectedSpace()}
          onChange={(e) => {
            setSelectedSpace(e.currentTarget.value)
            setSelectedProject("")
            setSearchQuery("")
          }}
        >
          <For each={spaceStore.spaces()}>
            {(space) => <option value={space.name}>{space.name}</option>}
          </For>
        </select>
      </div>

      {/* Project selector */}
      <div class="flex flex-col gap-1 w-full max-w-xs">
        <label class="text-11-medium text-v2-text-text-muted text-left">Project</label>
        <input
          type="text"
          class="w-full px-2.5 py-1.5 rounded-md bg-v2-background-bg-deep border border-v2-border-border-base text-12-regular text-v2-text-text-base placeholder:text-v2-text-text-faint"
          placeholder={selectedProject() ? selectedProject().split("/").pop() : "Search or select project…"}
          value={searchQuery()}
          onInput={(e) => {
            setSearchQuery(e.currentTarget.value)
            setSelectedProject("")
          }}
        />
        <Show when={projectOptions().length > 0}>
          <div class="max-h-32 overflow-y-auto border border-v2-border-border-base rounded-md bg-v2-background-bg-deep">
            <For each={projectOptions()}>
              {(dir) => (
                <button
                  type="button"
                  class="w-full px-2.5 py-1.5 text-left text-11-regular text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover truncate block cursor-pointer"
                  classList={{
                    "bg-v2-overlay-simple-overlay-hover/50": selectedProject() === dir.path,
                  }}
                  onClick={() => {
                    setSelectedProject(dir.path)
                    setSearchQuery("")
                  }}
                >
                  {dir.displayPath}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Type segmented control */}
      <div class="flex flex-col gap-1 w-full max-w-xs">
        <label class="text-11-medium text-v2-text-text-muted text-left">Type</label>
        <div class="flex rounded-md border border-v2-border-border-base overflow-hidden">
          <button
            type="button"
            class="flex-1 px-3 py-1.5 text-12-medium transition-colors cursor-pointer"
            classList={{
              "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base": sessionType() === "chat",
              "bg-v2-background-bg-deep text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover":
                sessionType() !== "chat",
            }}
            onClick={() => setSessionType("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            class="flex-1 px-3 py-1.5 text-12-medium transition-colors cursor-pointer border-l border-v2-border-border-base"
            classList={{
              "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base": sessionType() === "tui",
              "bg-v2-background-bg-deep text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover":
                sessionType() !== "tui",
            }}
            onClick={() => setSessionType("tui")}
          >
            TUI
          </button>
        </div>
      </div>

      {/* Start session button */}
      <button
        type="button"
        class="px-4 py-1.5 rounded-md bg-v2-icon-icon-brand text-white text-12-medium cursor-pointer transition-colors hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed mt-1"
        disabled={!selectedSpace() || !selectedProject()}
        onClick={handleStartSession}
      >
        开始会话
      </button>

      {/* Separator */}
      <div class="flex items-center gap-2 w-full max-w-xs mt-1">
        <div class="flex-1 h-px bg-v2-border-border-base" />
        <span class="text-10-regular text-v2-text-text-faint shrink-0">或</span>
        <div class="flex-1 h-px bg-v2-border-border-base" />
      </div>

      {/* Quick terminal button */}
      <button
        type="button"
        class="px-4 py-1.5 rounded-md border border-v2-border-border-base bg-v2-background-bg-deep text-v2-text-text-base text-12-medium cursor-pointer transition-colors hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={!selectedSpace()}
        onClick={handleQuickTerminal}
      >
        快速打开当前空间 Terminal
      </button>
    </div>
  )
}
