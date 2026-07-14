export type WorkbenchFixture = {
  name: string
  path: string
  directory: string
  capabilitySources: string[]
}

const globalPlugin = "/fixtures/global/plugins/global-plugin"

export const WORKBENCH_FIXTURES: Record<"general" | "spaceA" | "spaceB", WorkbenchFixture> = {
  general: {
    name: "General",
    path: "",
    directory: "/fixtures/wopal-home/general_tasks/task-a",
    capabilitySources: [globalPlugin],
  },
  spaceA: {
    name: "Space A",
    path: "/fixtures/workspaces/space-a",
    directory: "/fixtures/workspaces/space-a",
    capabilitySources: [globalPlugin, "/fixtures/workspaces/space-a/.wopal/plugins/space-a-plugin"],
  },
  spaceB: {
    name: "Space B",
    path: "/fixtures/workspaces/space-b",
    directory: "/fixtures/workspaces/space-b",
    capabilitySources: [globalPlugin, "/fixtures/workspaces/space-b/.wopal/plugins/space-b-plugin"],
  },
}

export const WORKBENCH_SCENARIO = {
  panels: {
    general: "panel-general",
    spaceA: "panel-space-a",
    spaceB: "panel-space-b",
  },
  sessions: {
    general: { id: "session-general", title: "General session", directory: WORKBENCH_FIXTURES.general.directory },
    spaceA: { id: "session-space-a", title: "Space A session", directory: WORKBENCH_FIXTURES.spaceA.directory },
    spaceB: { id: "session-space-b", title: "Space B session", directory: WORKBENCH_FIXTURES.spaceB.directory },
    forked: { id: "session-forked", title: "Forked session", directory: WORKBENCH_FIXTURES.spaceA.directory },
  },
  commands: {
    fork: "session.fork",
    undo: "session.undo",
  },
  ptys: {
    existing: "pty-existing",
    late: "pty-late",
  },
}

export type DirectoryTransportCall = {
  operation: string
  directory: string
  input: unknown
}

export type ControlledResponse = {
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

function createControlledResponse(): ControlledResponse {
  let resolveResponse: (value: unknown) => void = () => {}
  let rejectResponse: (reason: unknown) => void = () => {}
  const promise = new Promise<unknown>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })
  return {
    promise,
    resolve: resolveResponse,
    reject: rejectResponse,
  }
}

const responseKey = (operation: string, directory: string) => `${operation}\n${directory}`

export function createControlledDirectoryTransport() {
  const calls: DirectoryTransportCall[] = []
  const responses = new Map<string, ControlledResponse[]>()

  return {
    calls,
    prepare(operation: string, directory: string) {
      const response = createControlledResponse()
      const key = responseKey(operation, directory)
      const queue = responses.get(key)
      if (queue) queue.push(response)
      else responses.set(key, [response])
      return response
    },
    request(operation: string, directory: string, input?: unknown): Promise<unknown> {
      calls.push({ operation, directory, input })
      const key = responseKey(operation, directory)
      const queue = responses.get(key)
      const response = queue?.shift()
      if (!response) return Promise.reject(new Error(`No controlled response for ${operation} at ${directory}`))
      if (queue?.length === 0) responses.delete(key)
      return response.promise
    },
  }
}

export type WorkbenchHarnessSetupPhase = "store" | "actions"

export class WorkbenchHarnessSetupError extends Error {
  constructor(
    readonly phase: WorkbenchHarnessSetupPhase,
    cause: unknown,
  ) {
    super(`Workbench harness ${phase} setup failed`, { cause })
    this.name = "WorkbenchHarnessSetupError"
  }
}

export function composeWorkbenchHarness<TStore, TActions>(input: {
  createStore: () => TStore
  createActions: (context: {
    store: TStore
    transport: ReturnType<typeof createControlledDirectoryTransport>
  }) => TActions
}) {
  const transport = createControlledDirectoryTransport()
  let store: TStore
  try {
    store = input.createStore()
  } catch (error) {
    throw new WorkbenchHarnessSetupError("store", error)
  }

  let actions: TActions
  try {
    actions = input.createActions({ store, transport })
  } catch (error) {
    throw new WorkbenchHarnessSetupError("actions", error)
  }

  return { store, actions, transport }
}
