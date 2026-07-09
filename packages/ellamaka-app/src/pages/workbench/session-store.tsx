import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo, createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSessionPersist, limitSessions } from "./services/session-store-service"

export type SessionType = "tui" | "chat"

export type Session = {
  id: string
  spaceName: string
  projectPath: string
  type: SessionType
  title: string
  status: "idle" | "bound" | "archived"
  boundPanelId?: string
  createdAt: number
  lastActiveAt: number
}

let _nextSessionSeq = 0
function uniqueSessionID(): string {
  _nextSessionSeq++
  const ts = Date.now().toString(36)
  return `s-${ts}-${_nextSessionSeq}`
}

export const { use: useSessionStore, provider: SessionStoreProvider } = createSimpleContext({
  name: "SessionStore",
  init: () => {
    const [store, setStore] = createSessionPersist()
    const [refreshKey, setRefreshKey] = createSignal(0)

    function triggerRefresh() {
      setRefreshKey((k) => k + 1)
    }

    function spaceSessions(spaceName: string): Session[] {
      return store.spaces[spaceName] ?? []
    }

    const sessions = createMemo(() => store.spaces)

    function ensureSpace(spaceName: string) {
      if (!store.spaces[spaceName]) setStore("spaces", spaceName, [])
    }

    function createSession(
      spaceName: string,
      projectPath: string,
      type: SessionType,
      title: string,
    ): Session {
      ensureSpace(spaceName)
      const now = Date.now()
      const session: Session = {
        id: uniqueSessionID(),
        spaceName,
        projectPath,
        type,
        title,
        status: "idle",
        createdAt: now,
        lastActiveAt: now,
      }
      setStore(
        "spaces",
        spaceName,
        produce((list: Session[]) => {
          list.push(session)
        }),
      )
      triggerRefresh()
      return session
    }

    function updateSession(id: string, updates: Partial<Pick<Session, "title" | "type" | "projectPath">>) {
      for (const spaceName of Object.keys(store.spaces)) {
        const idx = store.spaces[spaceName].findIndex((s) => s.id === id)
        if (idx === -1) continue
        setStore(
          "spaces",
          spaceName,
          idx,
          produce((s: Session) => {
            if (updates.title !== undefined) s.title = updates.title
            if (updates.type !== undefined) s.type = updates.type
            if (updates.projectPath !== undefined) s.projectPath = updates.projectPath
            s.lastActiveAt = Date.now()
          }),
        )
        return
      }
    }

    function deleteSession(id: string) {
      for (const spaceName of Object.keys(store.spaces)) {
        const idx = store.spaces[spaceName].findIndex((s) => s.id === id)
        if (idx === -1) continue
        setStore(
          "spaces",
          spaceName,
          produce((list: Session[]) => {
            const index = list.findIndex((s) => s.id === id)
            if (index !== -1) {
              list.splice(index, 1)
            }
          }),
        )
        triggerRefresh()
        return
      }
    }

    function bindPanel(sessionId: string, panelId: string) {
      for (const spaceName of Object.keys(store.spaces)) {
        const idx = store.spaces[spaceName].findIndex((s) => s.id === sessionId)
        if (idx === -1) continue
        setStore(
          "spaces",
          spaceName,
          idx,
          produce((s: Session) => {
            s.status = "bound"
            s.boundPanelId = panelId
            s.lastActiveAt = Date.now()
          }),
        )
        return
      }
    }

    function unbindPanel(sessionId: string) {
      for (const spaceName of Object.keys(store.spaces)) {
        const idx = store.spaces[spaceName].findIndex((s) => s.id === sessionId)
        if (idx === -1) continue
        setStore(
          "spaces",
          spaceName,
          idx,
          produce((s: Session) => {
            s.status = "idle"
            s.boundPanelId = undefined
            s.lastActiveAt = Date.now()
          }),
        )
        return
      }
    }

    function archiveSession(id: string, archive: boolean = true) {
      const next = archive ? "archived" : "idle"
      for (const spaceName of Object.keys(store.spaces)) {
        const idx = store.spaces[spaceName].findIndex((s) => s.id === id)
        if (idx === -1) continue
        setStore(
          "spaces",
          spaceName,
          idx,
          produce((s: Session) => {
            s.status = next
            if (archive) s.boundPanelId = undefined
            s.lastActiveAt = Date.now()
          }),
        )
        triggerRefresh()
        return
      }
    }

    function renameSession(id: string, title: string) {
      for (const spaceName of Object.keys(store.spaces)) {
        const idx = store.spaces[spaceName].findIndex((s) => s.id === id)
        if (idx === -1) continue
        setStore(
          "spaces",
          spaceName,
          idx,
          produce((s: Session) => {
            s.title = title
            s.lastActiveAt = Date.now()
          }),
        )
        triggerRefresh()
        return
      }
    }

    function getSession(id: string): Session | undefined {
      for (const spaceName of Object.keys(store.spaces)) {
        const found = store.spaces[spaceName].find((s) => s.id === id)
        if (found) return found
      }
      return undefined
    }

    function ensureSessionReference(
      id: string,
      spaceName: string,
      projectPath: string,
      type: SessionType,
      title: string,
    ): Session {
      const existing = getSession(id)
      if (existing) return existing
      ensureSpace(spaceName)
      const now = Date.now()
      const session: Session = {
        id,
        spaceName,
        projectPath,
        type,
        title,
        status: "idle",
        createdAt: now,
        lastActiveAt: now,
      }
      setStore(
        "spaces",
        spaceName,
        produce((list: Session[]) => {
          list.push(session)
        }),
      )
      return session
    }

    function trimSessions(spaceName: string) {
      const list = store.spaces[spaceName]
      if (!list || list.length <= 50) return
      const trimmed = limitSessions(list)
      setStore("spaces", spaceName, trimmed)
    }

    return {
      sessions,
      spaceSessions,
      ensureSpace,
      createSession,
      updateSession,
      deleteSession,
      bindPanel,
      unbindPanel,
      archiveSession,
      renameSession,
      getSession,
      ensureSessionReference,
      trimSessions,
      refreshKey,
      triggerRefresh,
    }
  },
})
