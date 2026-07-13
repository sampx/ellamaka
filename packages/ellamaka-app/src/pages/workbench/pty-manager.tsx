export type PtyKind = "tui" | "term" | "split"

type PtyKey = string // `spacePath::panelId::kind`

type PtySDK = {
  client: {
    pty: {
      get: (input: { ptyID: string }) => Promise<unknown>
      remove: (input: { ptyID: string; directory?: string }) => Promise<unknown>
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
        await sdk.client.pty.remove({
          ptyID: ptyId,
          directory: this.ptyDirectories.get(ptyId),
        })
        this.ptyDirectories.delete(ptyId)
      } catch (err) {
        console.error(`Failed to dispose PTY ${ptyId}`, err)
      }
    }))
  }
}

export const ptyManager = new PtyManager()
