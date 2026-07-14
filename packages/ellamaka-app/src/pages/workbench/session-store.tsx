import { createSimpleContext } from "@opencode-ai/ui/context"
import { createMemo, createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { removeLegacySessionStorage } from "./services/session-store-legacy"
import { limitSessions } from "./services/session-store-service"

export type SessionType = "tui" | "chat"
export type DirectoryHealth = "healthy" | "missing" | "unavailable"

export type Session = {
  id: string
  spaceName: string
  projectPath: string
  type: SessionType
  title: string
  directoryHealth: DirectoryHealth
  timeArchived?: number
  createdAt: number
  lastActiveAt: number
}

export type SessionProjectionInput = Session
export type SessionProjectionPatch = Partial<
  Pick<Session, "title" | "type" | "projectPath" | "directoryHealth" | "timeArchived" | "lastActiveAt">
>

type SessionProjectionState = {
  spaces: Record<string, Session[]>
}

export function createSessionProjection() {
  const [store, setStore] = createStore<SessionProjectionState>({ spaces: {} })
  const [refreshKey, setRefreshKey] = createSignal(0)

  const find = (id: string) => {
    for (const [spaceName, sessions] of Object.entries(store.spaces)) {
      const index = sessions.findIndex((session) => session.id === id)
      if (index !== -1) return { spaceName, index, session: sessions[index] }
    }
    return undefined
  }

  const getSession = (id: string) => find(id)?.session

  const upsert = (input: SessionProjectionInput) => {
    const existing = find(input.id)
    if (existing?.spaceName === input.spaceName) {
      setStore("spaces", input.spaceName, existing.index, { ...input })
      return
    }
    if (existing) {
      setStore("spaces", existing.spaceName, (sessions) => sessions.filter((session) => session.id !== input.id))
    }
    if (!store.spaces[input.spaceName]) setStore("spaces", input.spaceName, [])
    setStore("spaces", input.spaceName, (sessions) => limitSessions([...sessions, { ...input }]))
  }

  const patch = (id: string, updates: SessionProjectionPatch) => {
    const existing = find(id)
    if (!existing) return false
    setStore("spaces", existing.spaceName, existing.index, produce((session) => {
      if (updates.title !== undefined) session.title = updates.title
      if (updates.type !== undefined) session.type = updates.type
      if (updates.projectPath !== undefined) session.projectPath = updates.projectPath
      if (updates.directoryHealth !== undefined) session.directoryHealth = updates.directoryHealth
      if (Object.hasOwn(updates, "timeArchived")) session.timeArchived = updates.timeArchived
      if (updates.lastActiveAt !== undefined) session.lastActiveAt = updates.lastActiveAt
    }))
    return true
  }

  const remove = (id: string) => {
    const existing = find(id)
    if (!existing) return false
    setStore("spaces", existing.spaceName, (sessions) => sessions.filter((session) => session.id !== id))
    return true
  }

  return {
    reader: {
      sessions: createMemo(() => store.spaces),
      spaceSessions: (spaceName: string) => store.spaces[spaceName] ?? [],
      getSession,
      refreshKey,
    },
    writer: {
      upsert,
      patch,
      remove,
      invalidate: () => setRefreshKey((key) => key + 1),
    },
  }
}

const SessionProjectionContext = createSimpleContext({
  name: "SessionProjection",
  init: () => {
    removeLegacySessionStorage(typeof window !== "undefined" ? window.localStorage : undefined)
    return createSessionProjection()
  },
})

export const useSessionStore = () => SessionProjectionContext.use().reader
export const useSessionProjectionWriter = () => SessionProjectionContext.use().writer
export const SessionStoreProvider = SessionProjectionContext.provider
