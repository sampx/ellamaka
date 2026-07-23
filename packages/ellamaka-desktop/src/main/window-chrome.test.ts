import { describe, expect, test } from "bun:test"
import { mainWindowChrome } from "./window-chrome"

describe("main window chrome", () => {
  test("uses the standard Windows frame required by the native menu bar", () => {
    const options = mainWindowChrome("win32")

    expect(options).toEqual({ autoHideMenuBar: false, frame: true })
    expect(options).not.toHaveProperty("titleBarStyle")
    expect(options).not.toHaveProperty("titleBarOverlay")
  })

  test("preserves the macOS hidden title bar and traffic lights", () => {
    expect(mainWindowChrome("darwin")).toEqual({
      autoHideMenuBar: true,
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 12, y: 14 },
    })
  })
})
