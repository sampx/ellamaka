// Mock electron module for Bun test environment
// Required because the main process imports from 'electron' which is only
// available within the Electron runtime, not in plain bun.
import { mock } from "bun:test"

mock.module("electron", () => ({
  app: {
    getPath: () => "/tmp",
    getVersion: () => "41.2.1",
    isPackaged: true,
    getName: () => "Ellamaka",
    on: () => {},
    whenReady: () => Promise.resolve(),
  },
  crashReporter: {
    start: () => {},
    addExtraParameter: () => {},
  },
  netLog: {
    startLogging: () => Promise.resolve(),
    stopLogging: () => Promise.resolve(),
  },
  utilityProcess: {
    fork: () => ({}),
  },
  shell: {
    openPath: () => Promise.resolve(""),
    openExternal: () => Promise.resolve(),
    trashItem: () => Promise.resolve(),
  },
  BrowserWindow: class {},
  Menu: {
    buildFromTemplate: () => ({}),
    setApplicationMenu: () => {},
  },
  dialog: {
    showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [] }),
    showSaveDialog: () => Promise.resolve({ canceled: false, filePath: "" }),
  },
  ipcMain: {
    handle: () => {},
    on: () => {},
    removeHandler: () => {},
    removeAllListeners: () => {},
  },
  session: {
    defaultSession: {
      setPermissionRequestHandler: () => {},
      setPreloads: () => {},
    },
  },
  nativeTheme: {
    themeSource: "system",
  },
  net: {
    fetch: () => Promise.reject(new Error("net mocked for tests")),
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
  },
  protocol: {
    registerSchemesAsPrivileged: () => {},
  },
  Notification: class {},
  default: {
    app: {
      getPath: () => "/tmp",
      getVersion: () => "41.2.1",
      isPackaged: true,
      getName: () => "Ellamaka",
      on: () => {},
      whenReady: () => Promise.resolve(),
    },
  },
}))

mock.module("electron-log", () => ({
  default: {
    log: () => {},
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
  },
  transports: {
    file: { maxSize: 0 },
  },
  initialize: () => {},
}))

mock.module("electron-log/main.js", () => ({
  default: {
    log: () => {},
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
  },
  transports: {
    file: { maxSize: 0, resolvePathFn: () => {} },
  },
  initialize: () => {},
}))

// Mock drizzle required by sidecar.ts (needs node:sqlite)
mock.module("drizzle-orm/node-sqlite/driver", () => ({
  drizzle: () => ({
    $client: null,
  }),
}))
