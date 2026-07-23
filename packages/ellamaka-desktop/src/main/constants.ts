import { app } from "electron"

type Channel = "local" | "main" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "local" || raw === "main" || raw === "beta" || raw === "prod" ? raw : "local"

export const SETTINGS_STORE = "ellamaka.settings"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const WSL_ENABLED_KEY = "wslEnabled"
export const PINCH_ZOOM_ENABLED_KEY = "pinchZoomEnabled"
export const UPDATER_ENABLED = app.isPackaged && (CHANNEL === "beta" || CHANNEL === "prod")
