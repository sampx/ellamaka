import { Persist, persisted } from "@/utils/persist"
import { createStore } from "solid-js/store"
import type { Session } from "../session-store"

const MAX_SESSIONS = 50

export type PersistedSessions = {
  spaces: Record<string, Session[]>
}

const DEFAULTS: PersistedSessions = { spaces: {} }

export function createSessionPersist() {
  return persisted(
    Persist.global("workbench.sessions", []),
    createStore<PersistedSessions>(DEFAULTS),
  )
}

export function limitSessions(sessions: Session[]): Session[] {
  if (sessions.length <= MAX_SESSIONS) return sessions
  return [...sessions]
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, MAX_SESSIONS)
}
