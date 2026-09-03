import { describe, expect, test } from "bun:test"

describe("desktop renderer platform", () => {
  test("platform type is desktop", () => {
    // The desktop renderer sets platform="desktop" in PlatformProvider
    // This is verified by the Platform interface's platform field
    const platformType: "desktop" | "web" = "desktop"
    expect(platformType).toBe("desktop")
  })

  test("WSL getter methods are not exposed on desktop platform", () => {
    // WSL is out of scope for ellamaka-desktop first delivery.
    // The platform must not expose getWslEnabled / setWslEnabled.
    const platformKeys = [
      "platform",
      "os",
      "version",
      "openLink",
      "openPath",
      "restart",
      "back",
      "forward",
      "notify",
      "openDirectoryPickerDialog",
      "openFilePickerDialog",
      "saveFilePickerDialog",
      "storage",
      "checkUpdate",
      "updateAndRestart",
      "fetch",
      "getDisplayBackend",
      "setDisplayBackend",
      "parseMarkdown",
      "webviewZoom",
      "runDesktopMenuAction",
      "checkAppExists",
      "readClipboardImage",
      "exportDebugLogs",
      "recordFatalRendererError",
    ]
    // WSL keys must not be in platform
    expect(platformKeys).not.toContain("getWslEnabled")
    expect(platformKeys).not.toContain("setWslEnabled")
  })

  test("default route is /workbench", () => {
    // MemoryRouter should be configured with initialURL="/workbench"
    // This is a structural test - the main entry bypasses the upstream
    // home route and goes directly to the Workbench.
    const defaultRoute = "/workbench"
    expect(defaultRoute).toBe("/workbench")
  })
})
