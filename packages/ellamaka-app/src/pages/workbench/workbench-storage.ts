import type { ServerConnection } from "@/context/server"

export const LEGACY_WORKBENCH_STORAGE_NAME = "workbench"
export const WORKBENCH_STORAGE_MIGRATION_NAME = "workbench.server-storage.v1"

function workbenchServerIdentity(server: ServerConnection.Any | undefined) {
  if (!server) return "unknown"
  if (server.type === "http") return `http:${server.http.url}`
  if (server.type === "ssh") return `ssh:${server.host}`
  if (server.variant === "wsl") return `wsl:${server.distro}`
  return "sidecar"
}

export function workbenchStorageName(server: ServerConnection.Any | undefined) {
  return `workbench:${encodeURIComponent(workbenchServerIdentity(server))}`
}

export function prepareWorkbenchStorage(storage: Storage | undefined, server: ServerConnection.Any | undefined) {
  const name = workbenchStorageName(server)
  if (!storage) return name

  try {
    const legacy = storage.getItem(LEGACY_WORKBENCH_STORAGE_NAME)
    if (legacy === null) return name

    const claimed = storage.getItem(WORKBENCH_STORAGE_MIGRATION_NAME)
    const current = storage.getItem(name)
    if (current !== null) {
      if (claimed === null) storage.setItem(WORKBENCH_STORAGE_MIGRATION_NAME, name)
      return name
    }
    if (claimed !== null) return name

    storage.setItem(WORKBENCH_STORAGE_MIGRATION_NAME, name)
    storage.setItem(name, legacy)
  } catch {}

  return name
}
