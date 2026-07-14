import { describe, expect, test } from "bun:test"
import {
  WORKBENCH_FIXTURES,
  WORKBENCH_SCENARIO,
  WorkbenchHarnessSetupError,
  composeWorkbenchHarness,
  createControlledDirectoryTransport,
} from "./workbench-test-harness"

describe("Workbench test harness", () => {
  test("keeps General and Space capability sources distinguishable by full path", () => {
    expect(WORKBENCH_FIXTURES.general).toEqual({
      name: "General",
      path: "",
      directory: "/fixtures/wopal-home/general_tasks/task-a",
      capabilitySources: ["/fixtures/global/plugins/global-plugin"],
    })
    expect(WORKBENCH_FIXTURES.spaceA.capabilitySources).toEqual([
      "/fixtures/global/plugins/global-plugin",
      "/fixtures/workspaces/space-a/.wopal/plugins/space-a-plugin",
    ])
    expect(WORKBENCH_FIXTURES.spaceB.capabilitySources).toEqual([
      "/fixtures/global/plugins/global-plugin",
      "/fixtures/workspaces/space-b/.wopal/plugins/space-b-plugin",
    ])
    expect(WORKBENCH_SCENARIO.sessions.general.directory).toBe(WORKBENCH_FIXTURES.general.directory)
    expect(WORKBENCH_SCENARIO.sessions.spaceA.directory).toBe(WORKBENCH_FIXTURES.spaceA.directory)
    expect(WORKBENCH_SCENARIO.commands.fork).toBe("session.fork")
    expect(WORKBENCH_SCENARIO.ptys.late).toBe("pty-late")
  })

  test("records canonical directory calls and permits stale responses to arrive last", async () => {
    const transport = createControlledDirectoryTransport()
    const spaceA = transport.prepare("capabilities.list", WORKBENCH_FIXTURES.spaceA.directory)
    const spaceB = transport.prepare("capabilities.list", WORKBENCH_FIXTURES.spaceB.directory)

    const first = transport.request("capabilities.list", WORKBENCH_FIXTURES.spaceA.directory)
    const second = transport.request("capabilities.list", WORKBENCH_FIXTURES.spaceB.directory)
    spaceB.resolve(WORKBENCH_FIXTURES.spaceB.capabilitySources)
    spaceA.resolve(WORKBENCH_FIXTURES.spaceA.capabilitySources)

    expect(await second).toEqual(WORKBENCH_FIXTURES.spaceB.capabilitySources)
    expect(await first).toEqual(WORKBENCH_FIXTURES.spaceA.capabilitySources)
    expect(transport.calls).toEqual([
      { operation: "capabilities.list", directory: WORKBENCH_FIXTURES.spaceA.directory, input: undefined },
      { operation: "capabilities.list", directory: WORKBENCH_FIXTURES.spaceB.directory, input: undefined },
    ])
  })

  test("labels setup failures separately from action behavior failures", () => {
    expect(() =>
      composeWorkbenchHarness({
        createStore: () => {
          throw new Error("provider missing")
        },
        createActions: () => ({ ready: true }),
      }),
    ).toThrow(WorkbenchHarnessSetupError)

    try {
      composeWorkbenchHarness({
        createStore: () => ({ ready: true }),
        createActions: () => {
          throw new Error("actions wiring missing")
        },
      })
    } catch (error) {
      expect(error).toBeInstanceOf(WorkbenchHarnessSetupError)
      expect(error instanceof WorkbenchHarnessSetupError ? error.phase : undefined).toBe("actions")
    }
  })
})
