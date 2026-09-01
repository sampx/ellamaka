import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import path from "path"
import os from "os"

describe("isWopalInstall", () => {
  let originalExecPath: string
  let originalWopalHome: string | undefined

  beforeEach(() => {
    originalExecPath = process.execPath
    originalWopalHome = process.env.WOPAL_HOME
    delete process.env.WOPAL_HOME
  })

  afterEach(() => {
    Object.defineProperty(process, "execPath", {
      value: originalExecPath,
      configurable: true,
    })
    if (originalWopalHome === undefined) {
      delete process.env.WOPAL_HOME
    } else {
      process.env.WOPAL_HOME = originalWopalHome
    }
  })

  function setExecPath(value: string) {
    Object.defineProperty(process, "execPath", {
      value,
      configurable: true,
    })
  }

  test("returns true when execPath is under default WOPAL_HOME/bin", async () => {
    const { isWopalInstall } = await import("../is-wopal-install")
    setExecPath(path.join(os.homedir(), ".wopal", "bin", "ellamaka"))
    expect(isWopalInstall()).toBe(true)
  })

  test("returns true when execPath is under custom WOPAL_HOME/bin", async () => {
    process.env.WOPAL_HOME = "/custom/wopal/home"
    const { isWopalInstall } = await import("../is-wopal-install")
    setExecPath(path.join("/custom/wopal/home", "bin", "ellamaka"))
    expect(isWopalInstall()).toBe(true)
  })

  test("returns true when WOPAL_HOME uses ~/ prefix", async () => {
    process.env.WOPAL_HOME = "~/my-wopal"
    const { isWopalInstall } = await import("../is-wopal-install")
    setExecPath(path.join(os.homedir(), "my-wopal", "bin", "ellamaka"))
    expect(isWopalInstall()).toBe(true)
  })

  test("returns false when execPath is not under wopal bin", async () => {
    const { isWopalInstall } = await import("../is-wopal-install")
    setExecPath("/usr/local/bin/ellamaka")
    expect(isWopalInstall()).toBe(false)
  })

  test("returns false when execPath is outside WOPAL_HOME/bin", async () => {
    const { isWopalInstall } = await import("../is-wopal-install")
    setExecPath(path.join(os.homedir(), ".wopal", "data", "ellamaka"))
    expect(isWopalInstall()).toBe(false)
  })
})
