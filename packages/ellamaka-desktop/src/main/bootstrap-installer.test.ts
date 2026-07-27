import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { installWopalCli } from "./bootstrap-installer"

describe("bootstrap-installer", () => {
  let testHome: string

  beforeEach(() => {
    testHome = join(tmpdir(), `bootstrap-installer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testHome, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true })
    }
  })

  test("installWopalCli reuses existing binary if valid", async () => {
    const binDir = join(testHome, "bin")
    const binPath = join(binDir, process.platform === "win32" ? "wopal.exe" : "wopal")
    mkdirSync(binDir, { recursive: true })
    writeFileSync(binPath, "#!/bin/sh\necho wopal 0.3.6", { mode: 0o755 })

    const fakeSpawn = () => {
      return {
        on: (event: string, cb: any) => {
          if (event === "exit") cb(0)
        },
        stdout: { on: () => {} },
        stderr: { on: () => {} },
      } as any
    }

    const res = await installWopalCli({
      homePath: testHome,
      spawnFn: fakeSpawn,
      fetchLatestVersion: async () => "0.3.6",
    })

    expect(res.status).toBe("reused")
    expect(res.result?.binaryPath).toBe(binPath)
  })

  test("installWopalCli spawns installer script when binary does not exist", async () => {
    let spawnedCmd = ""
    let spawnedArgs: string[] = []

    const fakeSpawn = (cmd: string, args: string[]) => {
      spawnedCmd = cmd
      spawnedArgs = args
      return {
        on: (event: string, cb: any) => {
          if (event === "exit") {
            // Fake creating the binary upon install success
            const binDir = join(testHome, "bin")
            const binPath = join(binDir, process.platform === "win32" ? "wopal.exe" : "wopal")
            mkdirSync(binDir, { recursive: true })
            writeFileSync(binPath, "#!/bin/sh\necho wopal 0.3.6", { mode: 0o755 })
            cb(0)
          }
        },
        stdout: { on: () => {} },
        stderr: { on: () => {} },
      } as any
    }

    const fakeFetchInstaller = async () => "echo fake installer"

    const res = await installWopalCli({
      homePath: testHome,
      spawnFn: fakeSpawn,
      fetchInstallerScript: fakeFetchInstaller,
    })

    expect(res.status).toBe("completed")
    expect(spawnedCmd).toBe(process.platform === "win32" ? "powershell" : "bash")
    expect(spawnedArgs).not.toContain(process.platform === "win32" ? "-Force" : "--force")
  })

  test("installWopalCli triggers upgrade when local version is older than latest", async () => {
    const binDir = join(testHome, "bin")
    const binPath = join(binDir, process.platform === "win32" ? "wopal.exe" : "wopal")
    mkdirSync(binDir, { recursive: true })
    writeFileSync(binPath, "#!/bin/sh\necho wopal 0.3.0", { mode: 0o755 })

    let upgradeTriggered = false
    const fakeSpawn = () => {
      upgradeTriggered = true
      return {
        on: (event: string, cb: any) => {
          if (event === "exit") {
            writeFileSync(binPath, "#!/bin/sh\necho wopal 0.3.6", { mode: 0o755 })
            cb(0)
          }
        },
        stdout: { on: () => {} },
        stderr: { on: () => {} },
      } as any
    }

    const res = await installWopalCli({
      homePath: testHome,
      spawnFn: fakeSpawn,
      fetchInstallerScript: async () => "echo upgrade",
      fetchLatestVersion: async () => "0.3.6",
    })

    expect(upgradeTriggered).toBe(true)
    expect(res.status).toBe("completed")
  })
})
