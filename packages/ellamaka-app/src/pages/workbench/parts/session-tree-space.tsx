import { For, Show, createMemo, createEffect, untrack } from "solid-js"
import type { WopalSpace } from "../space-store"
import type { GroupSession, SessionGroup } from "./session-tree-services"
import { SessionTreeRow } from "./session-tree-row"

type MergedSession = {
  id: string
  title: string
  status: "idle" | "bound" | "archived"
}

export function SessionTreeSpace(props: {
  space: WopalSpace
  isActive: boolean
  isPending: boolean
  expandedSpaces: () => Set<string>
  loading: () => boolean
  allGroups: SessionGroup[]
  spaces: WopalSpace[]
  activeSessionId: () => string | undefined
  pinnedSessions: () => Set<string>
  onSpaceClick: (space: WopalSpace) => void
  onSessionClick: (sessionId: string) => void
  onToggleSpace: (spaceName: string) => void
  onSpaceContextMenu: (e: MouseEvent, space: WopalSpace) => void
  onSessionContextMenu: (e: MouseEvent, session: MergedSession, spaceName: string, sessionData: GroupSession) => void
  setSelectedSessionId: (id: string) => void
  getSessionsForSpace: (spaceName: string) => GroupSession[]
  mergeSessions: (serverSessions: GroupSession[]) => MergedSession[]
  syncGroupTitles: (spaceName: string, sessions: GroupSession[]) => void
  loadSessionGroups: (force?: boolean) => void
  sessionStoreRefreshKey: () => number
  refreshVersion: number
  t: (key: string, params?: Record<string, string | number | boolean>) => string
}) {
  const isExpanded = createMemo(() => props.expandedSpaces().has(props.space.name))

  createEffect(() => {
    if (isExpanded() && props.allGroups.length === 0) {
      void untrack(() => props.loadSessionGroups())
    }
  })

  createEffect(() => {
    const key = props.sessionStoreRefreshKey()
    void key
    if (untrack(isExpanded)) {
      void untrack(() => props.loadSessionGroups())
    }
  })

  createEffect(() => {
    const ver = props.refreshVersion
    if (ver > 0 && untrack(isExpanded)) {
      void untrack(() => props.loadSessionGroups(true))
    }
  })

  const sessions = createMemo(() => props.getSessionsForSpace(props.space.name))
  const mergedSessions = createMemo(() => {
    const raw = sessions()
    props.syncGroupTitles(props.space.name, raw)
    return props.mergeSessions(raw)
  })

  return (
    <div>
      <button
        type="button"
        classList={{
          "group flex w-full items-center gap-2 text-left transition-all py-1.5": true,
          "bg-v2-background-bg-base hover:bg-v2-overlay-simple-overlay-hover px-2 font-medium rounded-md text-v2-text-text-strong shadow-sm":
            props.isActive,
          "bg-blue-50/40 dark:bg-blue-950/20 border border-dashed border-blue-500/30 px-2 rounded-md":
            !props.isActive && props.isPending,
          "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base rounded-md px-2":
            !props.isActive && !props.isPending,
        }}
        onClick={() => props.onSpaceClick(props.space)}
        onContextMenu={(e) => props.onSpaceContextMenu(e, props.space)}
      >
        <span
          class="size-5 flex items-center justify-center rounded hover:bg-v2-overlay-simple-overlay-hover cursor-pointer shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            props.onToggleSpace(props.space.name)
          }}
        >
          <svg
            class={`size-4 text-v2-text-text-muted transition-transform duration-200 ${
              isExpanded() ? "" : "-rotate-90"
            }`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </span>
        <span class="flex-1 truncate text-12-regular text-v2-text-text-base">{props.space.name}</span>
      </button>

      <Show when={isExpanded()}>
        <div class="ml-3">
          <Show
            when={!props.loading()}
            fallback={
              <div class="py-1 text-10-regular text-v2-text-text-faint">
                {props.t("common.loading")}
              </div>
            }
          >
            <For each={mergedSessions()}>
              {(session) => (
                <SessionTreeRow
                  session={session}
                  spaceName={props.space.name}
                  sessions={sessions()}
                  spaces={props.spaces}
                  activeSessionId={props.activeSessionId}
                  pinnedSessions={props.pinnedSessions}
                  onSessionClick={props.onSessionClick}
                  onContextMenu={(e) => {
                    const sessionData = sessions().find((s) => s.id === session.id)
                    if (!sessionData) return
                    props.onSessionContextMenu(e, session, props.space.name, sessionData)
                  }}
                  setSelectedSessionId={props.setSelectedSessionId}
                />
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  )
}
