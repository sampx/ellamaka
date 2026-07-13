export type PtyKind = "tui" | "term" | "split"

type PtyKey = string // `spacePath::panelId::kind`

type PtySDK = {
  client: {
    pty: {
      get: (input: { ptyID: string }) => Promise<unknown>
      remove: (input: { ptyID: string }) => Promise<unknown>
    }
  }
}

export type PtyReferences = Partial<Record<PtyKind, string | undefined>>

export type PtyPanel = {
  id: string
  tuiPtyId?: string
  termPtyId?: string
  splitPtyId?: string
}

const kinds: PtyKind[] = ["tui", "term", "split"]

export function ptyReferences(panel: PtyPanel): PtyReferences {
  return {
    tui: panel.tuiPtyId,
    term: panel.termPtyId,
    split: panel.splitPtyId,
  }
}

export class PtyManager {
  private activePtys = new Map<PtyKey, string>()
  private pendingEnsures = new Map<PtyKey, Promise<string>>()
  // Maps each PTY id to the directory the backend created it in. This is the
  // directory that must be sent in the `x-opencode-directory` header for any
  // DELETE/GET against that PTY — NOT the workbench spacePath, which can be
  // an empty string (the General space) and does not match the PTY cwd.
  private ptyDirectories = new Map<string, string>()
  // PTYs that were disposed via panel-close / Terminal.onClose while the page
  // was still alive. The caller also fires sdk.client.pty.remove, but that is
  // async and on pagehide the Promise may never reach the underlying fetch —
  // leaving the backend PTY orphaned. We remember the id here so the pagehide
  // handler can re-send a keepalive DELETE to guarantee cleanup.
  private disposedPendingCleanup = new Set<string>()

  private makeKey(spacePath: string, panelId: string, kind: PtyKind): PtyKey {
    return `${spacePath}::${panelId}::${kind}`
  }

  delete(spacePath: string, panelId: string, kind: PtyKind) {
    const key = this.makeKey(spacePath, panelId, kind)
    const activeId = this.activePtys.get(key)
    if (activeId) this.disposedPendingCleanup.add(activeId)
    this.activePtys.delete(key)
    this.pendingEnsures.delete(key)
  }

  async ensure(opts: {
    spacePath: string
    panelId: string
    kind: PtyKind
    existingPtyId: string | undefined
    sdk: PtySDK
    directory: string
    createFn: () => Promise<string>
  }): Promise<string> {
    const key = this.makeKey(opts.spacePath, opts.panelId, opts.kind)

    if (!opts.existingPtyId) {
      this.activePtys.delete(key)
    }

    // 1. If we already have a PTY active in memory for this key
    const active = this.activePtys.get(key)
    if (active) {
      return active
    }

    // 2. If there is already a pending create/probe for this key
    const pending = this.pendingEnsures.get(key)
    if (pending) {
      return pending
    }

    // 3. Start ensure promise
    const promise = (async () => {
      // 3.1. Probe existing PTY if hint is provided
      if (opts.existingPtyId) {
        try {
          await opts.sdk.client.pty.get({ ptyID: opts.existingPtyId })
          this.activePtys.set(key, opts.existingPtyId)
          this.ptyDirectories.set(opts.existingPtyId, opts.directory)
          this.disposedPendingCleanup.delete(opts.existingPtyId)
          return opts.existingPtyId
        } catch {
          // Stale ID, ignore and fall through to create
        }
      }

      // 3.2. Create new PTY
      const newPtyId = await opts.createFn()
      this.activePtys.set(key, newPtyId)
      this.ptyDirectories.set(newPtyId, opts.directory)
      return newPtyId
    })()

    this.pendingEnsures.set(key, promise)
    try {
      return await promise
    } finally {
      if (this.pendingEnsures.get(key) === promise) {
        this.pendingEnsures.delete(key)
      }
    }
  }

  async disposePty(opts: {
    spacePath: string
    panelId: string
    kind: PtyKind
    sdk: PtySDK
    knownPtyId?: string
  }): Promise<void> {
    await this.disposeKey(this.makeKey(opts.spacePath, opts.panelId, opts.kind), opts.sdk, opts.knownPtyId)
  }

  async disposePanel(spacePath: string, panelId: string, sdk: PtySDK, known: PtyReferences = {}): Promise<void> {
    await Promise.all(kinds.map((kind) => this.disposePty({
      spacePath,
      panelId,
      kind,
      sdk,
      knownPtyId: known[kind],
    })))
  }

  async disposeSpace(spacePath: string, sdk: PtySDK, panels: PtyPanel[] = []): Promise<void> {
    const known = new Map<PtyKey, string>()
    for (const panel of panels) {
      const refs = ptyReferences(panel)
      for (const kind of kinds) {
        const ptyId = refs[kind]
        if (ptyId) known.set(this.makeKey(spacePath, panel.id, kind), ptyId)
      }
    }

    const prefix = `${spacePath}::`
    const keys = new Set([
      ...Array.from(this.activePtys.keys()).filter((key) => key.startsWith(prefix)),
      ...Array.from(this.pendingEnsures.keys()).filter((key) => key.startsWith(prefix)),
      ...known.keys(),
    ])
    await Promise.all(Array.from(keys, (key) => this.disposeKey(key, sdk, known.get(key))))
  }

  clearMemoryOnly() {
    this.activePtys.clear()
    this.pendingEnsures.clear()
  }

  disposeAllSyncOnUnload(sdkUrl: string, directory: string, ptyIds: Iterable<string> = []) {
    const urlBase = (sdkUrl || window.location.origin).replace(/\/$/, "")
    const all = new Set<string>(ptyIds)
    for (const [key, ptyId] of this.activePtys) {
      const ptyDir = this.ptyDirectories.get(ptyId)
      // Only include if either the recorded directory matches or the
      // entry's key prefix matches `directory::` (legacy lookup).
      if (ptyDir === directory || key.startsWith(`${directory}::`)) all.add(ptyId)
    }
    for (const ptyId of all) {
      // Prefer the stored PTY cwd for the routing header — caller's `directory`
      // may be the (possibly empty) spacePath and not match the backend.
      const headerDir = this.ptyDirectories.get(ptyId) ?? directory
      try {
        fetch(`${urlBase}/pty/${ptyId}`, {
          method: "DELETE",
          keepalive: true,
          mode: "cors",
          headers: { "x-opencode-directory": encodeURIComponent(headerDir) },
        }).catch(() => {})
      } catch (err) {
        console.error("Failed to send keepalive unload delete for PTY", ptyId, err)
      }
    }
    for (const key of [...this.activePtys.keys(), ...this.pendingEnsures.keys()]) {
      if (key.startsWith(`${directory}::`)) {
        const ptyId = this.activePtys.get(key)
        if (ptyId) {
          this.ptyDirectories.delete(ptyId)
          this.disposedPendingCleanup.delete(ptyId)
        }
        this.activePtys.delete(key)
        this.pendingEnsures.delete(key)
      }
    }
  }

  // Unload path that does NOT depend on the in-memory store: by the time
  // pagehide fires, Terminal.onClose has already cleared store ptyIds and
  // called ptyManager.delete for each panel — so wb.spaces is empty of
  // ptyIds and disposeAllSyncOnUnload(per-space, knownIds) would find nothing.
  // This method drains the still-active ptyManager registry plus the
  // disposedPendingCleanup fallback set, sending a keepalive DELETE for each
  // against the PTY's real backend directory (stored at ensure time).
  disposeEverythingOnUnload(sdkUrl: string) {
    const urlBase = (sdkUrl || window.location.origin).replace(/\/$/, "")
    const sendDelete = (ptyId: string) => {
      const directory = this.ptyDirectories.get(ptyId)
      if (!directory) {
        console.error("[unload] no directory recorded for PTY", ptyId, "— skipping")
        return
      }
      try {
        fetch(`${urlBase}/pty/${ptyId}`, {
          method: "DELETE",
          keepalive: true,
          mode: "cors",
          headers: { "x-opencode-directory": encodeURIComponent(directory) },
        }).catch(() => {})
      } catch (err) {
        console.error("Failed to send keepalive unload delete for PTY", ptyId, err)
      }
    }
    // Active (still-bound) PTYs.
    for (const ptyId of this.activePtys.values()) {
      sendDelete(ptyId)
    }
    // PTYs already disposed by Terminal.onClose during the close cascade —
    // their sdk.client.pty.remove was async and may not have actually fired
    // before the page is torn down. Re-send with keepalive.
    for (const ptyId of this.disposedPendingCleanup) {
      sendDelete(ptyId)
    }
    this.activePtys.clear()
    this.pendingEnsures.clear()
    this.disposedPendingCleanup.clear()
    this.ptyDirectories.clear()
  }

  private async disposeKey(key: PtyKey, sdk: PtySDK, knownPtyId?: string): Promise<void> {
    const ptyIds = new Set<string>()
    if (knownPtyId) ptyIds.add(knownPtyId)

    const activePtyId = this.activePtys.get(key)
    if (activePtyId) ptyIds.add(activePtyId)
    this.activePtys.delete(key)

    const pending = this.pendingEnsures.get(key)
    this.pendingEnsures.delete(key)
    if (pending) {
      const pendingPtyId = await pending.catch(() => undefined)
      if (pendingPtyId) ptyIds.add(pendingPtyId)
      this.activePtys.delete(key)
    }

    await Promise.all(Array.from(ptyIds, async (ptyId) => {
      try {
        await sdk.client.pty.remove({ ptyID: ptyId })
        // backend confirmed removal — drop from the close-cleanup fallback
        this.disposedPendingCleanup.delete(ptyId)
        this.ptyDirectories.delete(ptyId)
      } catch (err) {
        console.error(`Failed to dispose PTY ${ptyId}`, err)
      }
    }))
  }
}

export const ptyManager = new PtyManager()
