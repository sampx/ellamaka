import { Persist, persisted } from "@/utils/persist"
import { createStore } from "solid-js/store"
import type { Session } from "../session-store"

const MAX_SESSIONS = 50

export type PersistedSessions = {
  spaces: Record<string, Session[]>
}

const DEFAULTS: PersistedSessions = { spaces: {} }

// Local-only sessions fabricated by the old createSession() path have IDs
// starting with "s-". They never existed in the backend and pollute the
// persisted store with ghost entries. Purge them on load.
function purgeFabricatedSessions(value: unknown): unknown {
  if (!value || typeof value !== "object") return value
  const v = value as { spaces?: Record<string, Session[]> }
  if (!v.spaces || typeof v.spaces !== "object") return value
  const cleaned: Record<string, Session[]> = {}
  for (const [spaceName, sessions] of Object.entries(v.spaces)) {
    if (!Array.isArray(sessions)) continue
    cleaned[spaceName] = sessions.filter((s) => !s.id.startsWith("s-"))
  }
  return { spaces: cleaned }
}

export function createSessionPersist() {
  return persisted(
    { ...Persist.global("workbench.sessions", []), migrate: purgeFabricatedSessions },
    createStore<PersistedSessions>(DEFAULTS),
  )
}

export function limitSessions(sessions: Session[]): Session[] {
  if (sessions.length <= MAX_SESSIONS) return sessions
  return [...sessions]
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, MAX_SESSIONS)
}
