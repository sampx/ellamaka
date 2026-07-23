import type { BrowserWindowConstructorOptions } from "electron"

export function mainWindowChrome(platform: NodeJS.Platform): Partial<BrowserWindowConstructorOptions> {
  if (platform === "win32") return { autoHideMenuBar: false, frame: true }
  if (platform === "darwin") {
    return {
      autoHideMenuBar: true,
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 12, y: 14 },
    }
  }
  return { autoHideMenuBar: true }
}
