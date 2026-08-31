export { Config } from "@/config/config"
export { Server } from "./server/server"
export { bootstrap } from "./cli/bootstrap"
export * as Log from "@wopal/ellamaka-core/util/log"
export { Database } from "@/storage/db"
export { JsonMigration } from "@/storage/json-migration"

// DSH runtime wiring surface (DESIGN-dsh-poc §3.4): the unified Runtime
// Manager, the default embedded manifest, the install-anchor resolver, the
// closure module loader, and the web/tool container mount entry points. The
// Desktop sidecar consumes these through `virtual:opencode-server` (declared
// in `packages/ellamaka-desktop/src/main/env.d.ts`), so the Bridge ships
// compiled inside the sidecar bundle while the `@deepseek-ai/*` runtime is
// loaded at startup from the materialised closure.
export { initializeDshRuntime, DEFAULT_DSH_RUNTIME_MANIFEST, resolveInstallAnchor } from "@wopal/ellamaka-cordis/runtime"
export type { InstallAnchor } from "@wopal/ellamaka-cordis/runtime"
export { createDshRuntimeApi } from "@wopal/ellamaka-cordis/runtime/loader"
export type { DshRuntimeApi } from "@wopal/ellamaka-cordis/runtime/loader"
export { bootDshWeb, bootDshTools } from "@wopal/ellamaka-cordis/dsh-web"
export type { DshWebHost, DshToolsHost } from "@wopal/ellamaka-cordis/dsh-web"
