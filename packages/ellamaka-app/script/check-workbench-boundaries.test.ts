import { describe, expect, test } from "bun:test"
import {
  inspectWorkbenchSources,
  reconcileBoundaryDebt,
  type BoundaryDebt,
  type SourceEntry,
} from "./check-workbench-boundaries"

const inspect = (...entries: SourceEntry[]) => inspectWorkbenchSources(entries)

describe("Workbench boundary checker", () => {
  test("rejects shared modules that import Workbench implementation", () => {
    const violations = inspect({
      file: "src/components/dialog-example.tsx",
      source: 'import { useWorkbenchState } from "@/pages/workbench/view-store"',
    })

    expect(violations).toEqual([
      {
        rule: "shared-workbench-import",
        file: "src/components/dialog-example.tsx",
        detail: "@/pages/workbench/view-store",
      },
    ])
  })

  test("rejects Workbench-only parameters in shared component contracts", () => {
    const violations = inspect({
      file: "src/components/dialog-example.tsx",
      source: "type DialogProps = { panelID: string; title: string }",
    })

    expect(violations).toEqual([
      {
        rule: "shared-workbench-parameter",
        file: "src/components/dialog-example.tsx",
        detail: "panelID",
      },
    ])
  })

  test("rejects side-effect owners imported by the Workbench Store", () => {
    const violations = inspect({
      file: "src/pages/workbench/view-store.tsx",
      source: [
        'import { useServerSDK } from "@/context/server-sdk"',
        'import { ptyManager } from "./pty-manager"',
      ].join("\n"),
    })

    expect(violations.map((item) => item.detail)).toEqual(["./pty-manager", "@/context/server-sdk"])
    expect(violations.every((item) => item.rule === "store-side-effect-import")).toBeTrue()
  })

  test("allows only the Workbench Shell adapter to register global commands", () => {
    const violations = inspect(
      {
        file: "src/pages/workbench/parts/panel-chat.tsx",
        source: 'command.register("session", () => [])',
      },
      {
        file: "src/pages/workbench/use-workbench-commands.tsx",
        source: 'command.register("workbench.session", () => [])',
      },
    )

    expect(violations).toEqual([
      {
        rule: "panel-global-command-registration",
        file: "src/pages/workbench/parts/panel-chat.tsx",
        detail: "session",
      },
    ])
  })

  test("rejects component-owned directory SDK construction", () => {
    const violations = inspect({
      file: "src/pages/workbench/parts/status.tsx",
      source: "const sdk = serverSDK.createDirSdkContext(directory)",
    })

    expect(violations).toEqual([
      {
        rule: "component-directory-sdk-construction",
        file: "src/pages/workbench/parts/status.tsx",
        detail: "createDirSdkContext",
      },
    ])
  })

  test("allows directory SDK providers only at the Workbench shell boundary", () => {
    const violations = inspect(
      {
        file: "src/pages/workbench/parts/panel-chat.tsx",
        source: "const view = <SDKProvider directory={directory} />",
      },
      {
        file: "src/pages/workbench/parts/workspace.tsx",
        source: "const view = <SDKProvider directory={directory} />",
      },
      {
        file: "src/pages/workbench/workbench-directory-provider.tsx",
        source: "const view = <SDKProvider directory={directory} />",
      },
    )

    expect(violations).toEqual([
      {
        rule: "workbench-sdk-provider-owner",
        file: "src/pages/workbench/parts/panel-chat.tsx",
        detail: "SDKProvider",
      },
    ])
  })

  test("allows the PTY runtime only behind the Workbench Actions adapter", () => {
    const violations = inspect(
      {
        file: "src/pages/workbench/parts/panel.tsx",
        source: 'import { ptyManager } from "../pty-manager"',
      },
      {
        file: "src/pages/workbench/workbench-actions-context.ts",
        source: 'import { ptyManager } from "./pty-manager"',
      },
    )

    expect(violations).toEqual([
      {
        rule: "component-pty-runtime-import",
        file: "src/pages/workbench/parts/panel.tsx",
        detail: "../pty-manager",
      },
    ])
  })

  test("rejects the legacy persisted Session projection key", () => {
    const violations = inspect(
      {
        file: "src/pages/workbench/session-store.tsx",
        source: 'const storageKey = "workbench.sessions"',
      },
      {
        file: "src/pages/workbench/services/session-store-legacy.ts",
        source: 'export const LEGACY_SESSION_STORAGE_KEY = "workbench.sessions"',
      },
    )

    expect(violations).toEqual([
      {
        rule: "persisted-session-projection",
        file: "src/pages/workbench/session-store.tsx",
        detail: "workbench.sessions",
      },
    ])
  })

  test("allows Session projection writes only in reconciliation owners", () => {
    const violations = inspect(
      {
        file: "src/pages/workbench/parts/panel.tsx",
        source: "const projection = useSessionProjectionWriter()",
      },
      {
        file: "src/pages/workbench/parts/session-tree.tsx",
        source: "const projection = useSessionProjectionWriter()",
      },
    )

    expect(violations).toEqual([
      {
        rule: "session-projection-writer-owner",
        file: "src/pages/workbench/parts/panel.tsx",
        detail: "useSessionProjectionWriter",
      },
    ])
  })

  test("requires technical debt to match exactly and reports stale entries", () => {
    const violations = inspect({
      file: "src/pages/workbench/view-store.tsx",
      source: 'import { ptyManager } from "./pty-manager"',
    })
    const debt: BoundaryDebt[] = [
      {
        rule: "store-side-effect-import",
        file: "src/pages/workbench/view-store.tsx",
        detail: "./pty-manager",
        owner: "Task 5",
        removeBy: "Task 5",
      },
    ]

    expect(reconcileBoundaryDebt(violations, debt)).toEqual({ unexpected: [], stale: [] })
    expect(reconcileBoundaryDebt([], debt)).toEqual({ unexpected: [], stale: debt })
  })
})
