type PtyKey = string // `spacePath::panelId::kind`

class PtyManagerImpl {
  private activePtys = new Map<PtyKey, string>()
  private pendingEnsures = new Map<PtyKey, Promise<string>>()

  private makeKey(spacePath: string, panelId: string, kind: "tui" | "term" | "split"): PtyKey {
    return `${spacePath}::${panelId}::${kind}`
  }

  async ensure(opts: {
    spacePath: string
    panelId: string
    kind: "tui" | "term" | "split"
    existingPtyId: string | undefined
    sdk: any
    createFn: () => Promise<string>
  }): Promise<string> {
    const key = this.makeKey(opts.spacePath, opts.panelId, opts.kind)

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
      this.pendingEnsures.delete(key)
    }
  }

  async disposePanel(spacePath: string, panelId: string, sdk: any): Promise<void> {
    const kinds: ("tui" | "term" | "split")[] = ["tui", "term", "split"]
    for (const kind of kinds) {
      const key = this.makeKey(spacePath, panelId, kind)
      const ptyId = this.activePtys.get(key)
      if (ptyId) {
        this.activePtys.delete(key)
        try {
          await sdk.client.pty.remove({ ptyID: ptyId })
        } catch (err) {
          console.error(`Failed to dispose PTY ${ptyId}`, err)
        }
      }
    }
  }

  async disposeSpace(spacePath: string, sdk: any): Promise<void> {
    for (const [key, ptyId] of this.activePtys.entries()) {
      if (key.startsWith(spacePath + "::")) {
        this.activePtys.delete(key)
        try {
          await sdk.client.pty.remove({ ptyID: ptyId })
        } catch (err) {
          console.error(`Failed to dispose PTY ${ptyId} in space ${spacePath}`, err)
        }
      }
    }
  }

  clearMemoryOnly() {
    this.activePtys.clear()
    this.pendingEnsures.clear()
  }
}

export const ptyManager = new PtyManagerImpl()
