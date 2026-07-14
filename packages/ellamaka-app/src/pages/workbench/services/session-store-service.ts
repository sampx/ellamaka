import type { Session } from "../session-store"

const MAX_SESSIONS = 50

export function limitSessions(sessions: Session[]): Session[] {
  if (sessions.length <= MAX_SESSIONS) return sessions
  return [...sessions]
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, MAX_SESSIONS)
}
