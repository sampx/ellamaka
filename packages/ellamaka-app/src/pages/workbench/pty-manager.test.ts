import { describe, expect, mock, test } from "bun:test"
import { PtyManager } from "./pty-manager"

function createSDK() {
  const removed: string[] = []
  return {
    removed,
    sdk: {
      client: {
        pty: {
          get: async () => {
            throw new Error("not found")
          },
          remove: async ({ ptyID }: { ptyID: string }) => {
            removed.push(ptyID)
          },
        },
      },
    },
  }
}

function captureFetchCalls() {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const original = globalThis.fetch
  const fetchMock = mock((_input: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(_input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    return Promise.resolve(new Response())
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

describe("PtyManager", () => {
  test("destroys a persisted panel PTY even when it is not in the in-memory registry", async () => {
    const manager = new PtyManager()
    const { removed, sdk } = createSDK()

    await manager.disposePanel("/space", "panel-1", sdk, {
      split: "pty-persisted",
    })

    expect(removed).toEqual(["pty-persisted"])
  })

  test("destroys a PTY that finishes creating after its terminal is closed", async () => {
    const manager = new PtyManager()
    const { removed, sdk } = createSDK()
    let resolveCreation!: (ptyID: string) => void

    const creating = manager.ensure({
      spacePath: "/space",
      panelId: "panel-1",
      kind: "split",
      existingPtyId: undefined,
      sdk,
      directory: "/space",
      createFn: () => new Promise<string>((resolve) => {
        resolveCreation = resolve
      }),
    })
    const disposing = manager.disposePty({
      spacePath: "/space",
      panelId: "panel-1",
      kind: "split",
      sdk,
    })

    resolveCreation("pty-racing")
    await Promise.all([creating, disposing])

    expect(removed).toEqual(["pty-racing"])
  })

  test("routes normal disposal through the PTY's real directory", async () => {
    const manager = new PtyManager()
    const removals: Array<{ ptyID: string; directory?: string }> = []
    const sdk = {
      client: {
        pty: {
          get: async () => {
            throw new Error("not found")
          },
          remove: async (input: { ptyID: string; directory?: string }) => {
            removals.push(input)
          },
        },
      },
    }

    await manager.ensure({
      spacePath: "",
      panelId: "panel-1",
      kind: "tui",
      existingPtyId: undefined,
      sdk,
      directory: "/real/session/directory",
      createFn: async () => "pty-panel",
    })
    await manager.disposePanel("", "panel-1", sdk, { tui: "pty-panel" })

    expect(removals).toEqual([{
      ptyID: "pty-panel",
      directory: "/real/session/directory",
    }])
  })

  test("disposeAllSyncOnUnload sends DELETE to /pty/:id with x-opencode-directory header", async () => {
    const manager = new PtyManager()
    const { calls, restore } = captureFetchCalls()

    manager.disposeAllSyncOnUnload("http://localhost:4096", "/my/space", ["pty-1", "pty-2"])

    await Promise.resolve()

    expect(calls.length).toBe(2)
    expect(calls[0].url).toBe("http://localhost:4096/pty/pty-1")
    expect(calls[0].headers["x-opencode-directory"]).toBe(encodeURIComponent("/my/space"))
    expect(calls[1].url).toBe("http://localhost:4096/pty/pty-2")
    expect(calls[1].headers["x-opencode-directory"]).toBe(encodeURIComponent("/my/space"))

    restore()
  })

  test("disposeEverythingOnUnload uses PTY's real cwd from ensure, not spacePath", async () => {
    const manager = new PtyManager()
    const { sdk } = createSDK()
    const { calls, restore } = captureFetchCalls()

    // General space has empty spacePath, but PTY cwd is a real directory.
    // The x-opencode-directory header must route to the real cwd, not "".
    await manager.ensure({
      spacePath: "",
      panelId: "p1",
      kind: "tui",
      existingPtyId: undefined,
      sdk,
      directory: "/Users/sam/.wopal/general_tasks/2026-07-12T03-45-16",
      createFn: async () => "pty-real",
    })

    // Simulate Terminal.onClose running first (clears activePtys, marks pending cleanup)
    manager.delete("", "p1", "tui")

    manager.disposeEverythingOnUnload("http://localhost:4096")

    await Promise.resolve()

    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe("http://localhost:4096/pty/pty-real")
    expect(calls[0].headers["x-opencode-directory"]).toBe(
      encodeURIComponent("/Users/sam/.wopal/general_tasks/2026-07-12T03-45-16"),
    )

    restore()
  })
})
