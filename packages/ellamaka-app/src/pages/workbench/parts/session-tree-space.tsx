import { For, Show, createMemo } from "solid-js"
import type { WopalSpace } from "../space-store"
import type { GroupSession, SessionTreeLocation } from "./session-tree-services"
import { SessionTreeRow } from "./session-tree-row"

type MergedSession = {
  id: string
  title: string
  status: "idle" | "bound" | "archived"
}

export function SessionTreeSpace(props: {
  space: WopalSpace
  isActive: boolean
  expandedSpaces: () => Set<string>
  loading: () => boolean
  locations: () => SessionTreeLocation[]
  activeSessionId: () => string | undefined
  pinnedSessions: () => Set<string>
  onSpaceClick: (space: WopalSpace) => void
  onSessionClick: (sessionId: string) => void
  onToggleSpace: (spacePath: string) => void
  onSpaceContextMenu: (e: MouseEvent, space: WopalSpace) => void
  onSessionContextMenu: (e: MouseEvent, session: MergedSession, spacePath: string, sessionData: GroupSession, locationKind: SessionTreeLocation["kind"]) => void
  setSelectedSessionId: (id: string) => void
  mergeSessions: (serverSessions: GroupSession[]) => MergedSession[]
  registerRowRef?: (sessionId: string, el: HTMLButtonElement | null) => void
  t: (key: string, params?: Record<string, string | number | boolean>) => string
}) {
  const isExpanded = createMemo(() => props.expandedSpaces().has(props.space.path))

  return (
    <div>
      <button
        type="button"
        classList={{
          "group flex w-full items-center gap-2 text-left transition-all py-1.5": true,
          "bg-v2-background-bg-base hover:bg-v2-overlay-simple-overlay-hover px-2 font-medium rounded-md text-v2-text-text-strong shadow-sm":
            props.isActive,
          "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base rounded-md px-2":
            !props.isActive,
        }}
        onClick={() => props.onSpaceClick(props.space)}
        onContextMenu={(e) => props.onSpaceContextMenu(e, props.space)}
      >
        <span
          class="size-5 flex items-center justify-center rounded hover:bg-v2-overlay-simple-overlay-hover cursor-pointer shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            props.onToggleSpace(props.space.path)
          }}
        >
          <svg
            class={`size-4 text-v2-text-text-muted transition-transform duration-200 ${isExpanded() ? "" : "-rotate-90"}`}
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
            fallback={<div class="py-1 text-10-regular text-v2-text-text-faint">{props.t("common.loading")}</div>}
          >
            <For each={props.locations()}>
              {(location) => {
                const merged = createMemo(() => props.mergeSessions(location.sessions))
                return (
                  <div class="py-0.5">
                    <Show when={location.kind !== "space-root"}>
                      <div class="px-2 pt-1 text-10-regular text-v2-text-text-faint truncate">{location.label}</div>
                    </Show>
                    <For each={merged()}>
                      {(session) => (
                        <SessionTreeRow
                          session={session}
                          spaceName={props.space.name}
                          spacePath={props.space.path}
                          sessions={location.sessions}
                          activeSessionId={props.activeSessionId}
                          pinnedSessions={props.pinnedSessions}
                          onSessionClick={props.onSessionClick}
                          onContextMenu={(event) => {
                            const sessionData = location.sessions.find((candidate) => candidate.id === session.id)
                            if (sessionData) props.onSessionContextMenu(event, session, props.space.path, sessionData, location.kind)
                          }}
                          setSelectedSessionId={props.setSelectedSessionId}
                          registerRowRef={props.registerRowRef}
                        />
                      )}
                    </For>
                  </div>
                )
              }}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  )
}
