import { describe, expect, test } from "bun:test"
import { activateSpaceTab } from "./space-tab-activation"

describe("activateSpaceTab", () => {
  test("exits DSH view and activates the tab when DSH is visible", () => {
    const calls: string[] = []
    const wb = {
      dshVisible: true,
      setDshVisible: (v: boolean) => calls.push(`dsh:${v}`),
      setActive: (path: string) => calls.push(`active:${path}`),
    }
    activateSpaceTab(wb as never, "/space-a")
    expect(calls).toEqual(["dsh:false", "active:/space-a"])
  })

  test("activates the tab without touching DSH state when DSH is hidden", () => {
    const calls: string[] = []
    const wb = {
      dshVisible: false,
      setDshVisible: (v: boolean) => calls.push(`dsh:${v}`),
      setActive: (path: string) => calls.push(`active:${path}`),
    }
    activateSpaceTab(wb as never, "/space-b")
    expect(calls).toEqual(["active:/space-b"])
  })
})

describe("Space Tab Activity Calculation", () => {
  test("returns true when any bound session in the space is working via sync or serverSync", () => {
    const panels = [
      { slotState: "bound", boundSessionId: "session-1", directory: "/project-a" },
      { slotState: "empty" },
    ]
    const syncWorking = new Set<string>()
    const serverSyncStores: Record<string, Set<string>> = {
      "/project-a": new Set(["session-1"]),
    }

    const checkBusy = (panelsList: typeof panels) => {
      for (const panel of panelsList) {
        if (panel.slotState === "bound" && panel.boundSessionId) {
          if (syncWorking.has(panel.boundSessionId)) return true
          if (panel.directory && serverSyncStores[panel.directory]?.has(panel.boundSessionId)) return true
        }
      }
      return false
    }

    expect(checkBusy(panels)).toBe(true)
  })

  test("returns true when spaceSessions contains a working session in a project subdirectory via serverSync even if root sync returns false", () => {
    const panels = [{ slotState: "empty", boundSessionId: undefined, directory: undefined }]
    const spaceSessions = [{ id: "session-sub-1", projectPath: "/space-1/subproject" }]
    const syncWorking = new Set<string>()
    const serverSyncStores: Record<string, Set<string>> = {
      "/space-1/subproject": new Set(["session-sub-1"]),
    }

    const candidateIds = new Set<string>()
    const candidateDirs = new Set<string>()
    for (const s of spaceSessions) {
      candidateIds.add(s.id)
      if (s.projectPath) candidateDirs.add(s.projectPath)
    }

    let isSpaceBusy = false
    for (const id of candidateIds) {
      if (syncWorking.has(id)) isSpaceBusy = true
      for (const dir of candidateDirs) {
        if (serverSyncStores[dir]?.has(id)) isSpaceBusy = true
      }
    }

    expect(isSpaceBusy).toBe(true)
  })

  test("returns false when all bound sessions and spaceSessions in the space are idle across all directories", () => {
    const panels = [
      { slotState: "bound", boundSessionId: "session-2", directory: "/space-1" },
    ]
    const spaceSessions = [{ id: "session-3", projectPath: "/space-1/sub" }]
    const syncWorking = new Set(["session-1"])
    const serverSyncStores: Record<string, Set<string>> = {
      "/space-1": new Set(["session-1"]),
      "/space-1/sub": new Set(),
    }

    const candidateIds = new Set<string>()
    const candidateDirs = new Set<string>()
    for (const panel of panels) {
      if (panel.slotState === "bound" && panel.boundSessionId) {
        candidateIds.add(panel.boundSessionId)
        if (panel.directory) candidateDirs.add(panel.directory)
      }
    }
    for (const s of spaceSessions) {
      candidateIds.add(s.id)
      if (s.projectPath) candidateDirs.add(s.projectPath)
    }

    let isSpaceBusy = false
    for (const id of candidateIds) {
      if (syncWorking.has(id)) isSpaceBusy = true
      for (const dir of candidateDirs) {
        if (serverSyncStores[dir]?.has(id)) isSpaceBusy = true
      }
    }

    expect(isSpaceBusy).toBe(false)
  })
})
