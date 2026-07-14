import { describe, expect, test } from "bun:test"
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

  test("delete removes PTY from active registry without tracking for unload cleanup", async () => {
    const manager = new PtyManager()
    const { sdk } = createSDK()

    await manager.ensure({
      spacePath: "",
      panelId: "p1",
      kind: "tui",
      existingPtyId: undefined,
      sdk,
      directory: "/real/dir",
      createFn: async () => "pty-1",
    })

    manager.delete("", "p1", "tui")

    // After delete, re-ensuring with the same key should create a new PTY
    // (the old one is gone from the active registry, not held by any cleanup set)
    const id2 = await manager.ensure({
      spacePath: "",
      panelId: "p1",
      kind: "tui",
      existingPtyId: undefined,
      sdk,
      directory: "/real/dir",
      createFn: async () => "pty-2",
    })

    expect(id2).toBe("pty-2")
  })

  test("does not expose unload disposal methods", () => {
    const manager = new PtyManager()
    expect("disposeEverythingOnUnload" in manager).toBeFalse()
    expect("disposeAllSyncOnUnload" in manager).toBeFalse()
  })
})
