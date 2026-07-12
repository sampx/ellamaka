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

  private makeKey(spacePath: string, panelId: string, kind: PtyKind): PtyKey {
    return `${spacePath}::${panelId}::${kind}`
  }

  delete(spacePath: string, panelId: string, kind: PtyKind) {
    const key = this.makeKey(spacePath, panelId, kind)
    this.activePtys.delete(key)
    this.pendingEnsures.delete(key)
  }

  async ensure(opts: {
    spacePath: string
    panelId: string
    kind: PtyKind
    existingPtyId: string | undefined
    sdk: PtySDK
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
          return opts.existingPtyId
        } catch {
          // Stale ID, ignore and fall through to create
        }
      }

      // 3.2. Create new PTY
      const newPtyId = await opts.createFn()
      this.activePtys.set(key, newPtyId)
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
    console.warn("[PTY-DIAG] disposeSpace called", {
      spacePath,
      panelCount: panels.length,
      panels: panels.map(p => ({ id: p.id, tui: p.tuiPtyId, term: p.termPtyId, split: p.splitPtyId })),
      activePtysKeys: Array.from(this.activePtys.keys()),
      activePtysValues: Array.from(this.activePtys.entries()),
      pendingKeys: Array.from(this.pendingEnsures.keys()),
    })

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

    console.warn("[PTY-DIAG] disposeSpace keys to dispose", {
      prefix,
      knownEntries: Array.from(known.entries()),
      keysToDispose: Array.from(keys),
    })

    await Promise.all(Array.from(keys, (key) => this.disposeKey(key, sdk, known.get(key))))
  }

  clearMemoryOnly() {
    this.activePtys.clear()
    this.pendingEnsures.clear()
  }

  disposeAllSyncOnUnload(sdkUrl: string, knownPtyIds: Iterable<string> = []) {
    const urlBase = sdkUrl || window.location.origin
    const ptyIds = new Set([...this.activePtys.values(), ...knownPtyIds])
    for (const ptyId of ptyIds) {
      const targetUrl = `${urlBase.replace(/\/$/, "")}/api/pty/${ptyId}`
      try {
        // 使用 keepalive 保证即使页面卸载/标签页关闭，DELETE 销毁请求也能在后台发出并完成
        fetch(targetUrl, {
          method: "DELETE",
          keepalive: true,
          mode: "cors",
        }).catch(() => {})
      } catch (err) {
        console.error("Failed to send keepalive unload delete for PTY", ptyId, err)
      }
    }
    this.activePtys.clear()
    this.pendingEnsures.clear()
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

    console.warn("[PTY-DIAG] disposeKey", { key, knownPtyId, activePtyId, ptyIdsToKill: Array.from(ptyIds) })

    await Promise.all(Array.from(ptyIds, async (ptyId) => {
      try {
        console.warn("[PTY-DIAG] calling sdk.client.pty.remove", { ptyId })
        await sdk.client.pty.remove({ ptyID: ptyId })
        console.warn("[PTY-DIAG] pty.remove succeeded", { ptyId })
      } catch (err) {
        console.error(`[PTY-DIAG] Failed to dispose PTY ${ptyId}`, err)
      }
    }))
  }
}

export const ptyManager = new PtyManager()
