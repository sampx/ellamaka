const LAST_OFFICIAL_ROUTE_KEY = "ellamaka.workbench.last-official-route"

export function rememberOfficialRoute(path: string) {
  if (!path || path.startsWith("/workbench")) return
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.setItem(LAST_OFFICIAL_ROUTE_KEY, path)
  } catch {}
}

export function resolveOfficialRoute() {
  if (typeof sessionStorage === "undefined") return "/"
  try {
    return sessionStorage.getItem(LAST_OFFICIAL_ROUTE_KEY) || "/"
  } catch {
    return "/"
  }
}
