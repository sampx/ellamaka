interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
  readonly MIN_WOPAL_CLI_VERSION: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:opencode-server" {
  export namespace Server {
    export const listen: typeof import("../../../opencode/dist/types/src/node").Server.listen
    export type Listener = import("../../../opencode/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../opencode/dist/types/src/node").Config.get
    export type Info = import("../../../opencode/dist/types/src/node").Config.Info
  }
  export namespace Log {
    export const init: typeof import("@wopal/ellamaka-core/util/log").Log.init
    export const setLevel: typeof import("@wopal/ellamaka-core/util/log").Log.setLevel
  }
  export namespace Database {
    export const getPath: typeof import("../../../opencode/dist/types/src/node").Database.getPath
    export const Client: typeof import("../../../opencode/dist/types/src/node").Database.Client
  }
  export namespace JsonMigration {
    export type Progress = import("../../../opencode/dist/types/src/node").JsonMigration.Progress
    export const run: typeof import("../../../opencode/dist/types/src/node").JsonMigration.run
  }
  export const bootstrap: typeof import("../../../opencode/dist/types/src/node").bootstrap

  /**
   * The DSH runtime wiring surface (DESIGN-dsh-poc §3.4), re-exported as flat
   * symbols by the opencode `node.ts` and consumed by the sidecar to drive the
   * unified Runtime Manager and mount the web/tool containers. Typed
   * structurally so the desktop package needs no `@wopal/ellamaka-cordis`
   * dependency; the value side is compiled into the sidecar bundle.
   */
  export type DshRuntimeStatus = "disabled" | "preparing" | "ready" | "degraded"

  export interface DshRuntimeManifest {
    schema: "ellamaka.dsh-runtime/v1"
    bridgeAbi: number
    dependencies: Record<string, string>
    fingerprint?: string
  }

  export interface DshInstallAnchor {
    path: string
    genId: string
  }

  export interface DshInitializeOptions {
    wopalHome: string
    logFile: string
    entry: "serve" | "web" | "tui"
    manifest: DshRuntimeManifest
  }

  export const initializeDshRuntime: (options: DshInitializeOptions) => Promise<DshRuntimeStatus>
  export const DEFAULT_DSH_RUNTIME_MANIFEST: DshRuntimeManifest
  export const resolveInstallAnchor: (wopalHome: string, manifest: DshRuntimeManifest) => DshInstallAnchor
  export const createDshRuntimeApi: (installAnchor: string) => DshRuntimeApi

  /** The six official DSH runtime modules resolved from the closure. */
  export interface DshRuntimeApi {
    cordis: unknown
    pluginLoader: unknown
    appBoot: unknown
    cmdline: unknown
    launchEnv: unknown
    hostWebserver: unknown
  }

  export interface DshWebHostOptions {
    home?: string
    port: number
    installAnchor?: string
    logFile?: string
    runtime?: DshRuntimeApi
    disableCodeRuntime?: boolean
  }

  export interface DshWebHost {
    mountPath: "/dsh"
    webServer: {
      request(req: unknown, res: unknown): void
      upgrade(req: unknown, socket: unknown, head: unknown): void
    }
    dispose(): Promise<void>
  }

  export interface DshToolsHost {
    ctx: unknown
    dispose(): Promise<void>
  }

  export const bootDshWeb: (opts: DshWebHostOptions) => Promise<DshWebHost>
  export const bootDshTools: (opts: DshWebHostOptions) => Promise<DshToolsHost>
}
