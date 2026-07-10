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
})
