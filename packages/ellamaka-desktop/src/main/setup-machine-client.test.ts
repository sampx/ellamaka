import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runSetupOperation } from "./setup-machine-client"

describe("setup-machine-client", () => {
  let testHome: string = ""
  let binPath: string = ""

  beforeEach(() => {
    testHome = join(tmpdir(), `setup-machine-client-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(testHome, "bin"), { recursive: true })
    binPath = join(testHome, "bin", process.platform === "win32" ? "wopal.exe" : "wopal")
    writeFileSync(binPath, "#!/bin/sh\necho test", { mode: 0o755 })
  })

  afterEach(() => {
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true })
    }
  })

  test("runSetupOperation returns binary not found error when path invalid", async () => {
    const res = await runSetupOperation({
      binaryPath: join(testHome, "bin", "nonexistent"),
      operation: "inspect",
    })

    expect(res.status).toBe("failed")
    expect(res.error?.code).toBe("WOPAL_BINARY_NOT_FOUND")
  })

  test("runSetupOperation parses valid success capability envelope and unpacks data.result", async () => {
    const fakeEnvelope = {
      apiVersion: "wopal.capability/v1",
      capability: "setup.operation",
      ok: true,
      data: {
        operation: "inspect",
        status: "created",
        result: { verdict: "ready", availableTypes: [{ type: "common", branch: "main" }] },
      },
    }

    const fakeSpawn = () => {
      return {
        stdin: { write: () => {}, end: () => {} },
        stdout: {
          on: (event: string, cb: any) => {
            if (event === "data") cb(JSON.stringify(fakeEnvelope))
          },
        },
        stderr: { on: () => {} },
        on: (event: string, cb: any) => {
          if (event === "exit") cb(0)
        },
      } as any
    }

    const res = await runSetupOperation({
      binaryPath: join(testHome, "bin", process.platform === "win32" ? "wopal.exe" : "wopal"),
      operation: "inspect",
      spawnFn: fakeSpawn,
    })

    // CLI created → Desktop completed
    expect(res.status).toBe("completed")
    // Business result is envelope.data.result, not envelope.data
    expect(res.result).toEqual({ verdict: "ready", availableTypes: [{ type: "common", branch: "main" }] })
  })

  test("runSetupOperation maps CLI reused → Desktop reused", async () => {
    const fakeEnvelope = {
      apiVersion: "wopal.capability/v1",
      capability: "setup.operation",
      ok: true,
      data: {
        operation: "inspect",
        status: "reused",
        result: { engineInstalled: true },
      },
    }

    const fakeSpawn = () => {
      return {
        stdin: { write: () => {}, end: () => {} },
        stdout: {
          on: (event: string, cb: any) => {
            if (event === "data") cb(JSON.stringify(fakeEnvelope))
          },
        },
        stderr: { on: () => {} },
        on: (event: string, cb: any) => {
          if (event === "exit") cb(0)
        },
      } as any
    }

    const res = await runSetupOperation({
      binaryPath: join(testHome, "bin", process.platform === "win32" ? "wopal.exe" : "wopal"),
      operation: "inspect",
      spawnFn: fakeSpawn,
    })

    expect(res.status).toBe("reused")
    expect(res.result).toEqual({ engineInstalled: true })
  })

  test("runSetupOperation maps CLI skipped → Desktop skipped", async () => {
    const fakeEnvelope = {
      apiVersion: "wopal.capability/v1",
      capability: "setup.operation",
      ok: true,
      data: {
        operation: "star",
        status: "skipped",
        result: { outcome: "user-declined" },
      },
    }

    const fakeSpawn = () => {
      return {
        stdin: { write: () => {}, end: () => {} },
        stdout: {
          on: (event: string, cb: any) => {
            if (event === "data") cb(JSON.stringify(fakeEnvelope))
          },
        },
        stderr: { on: () => {} },
        on: (event: string, cb: any) => {
          if (event === "exit") cb(0)
        },
      } as any
    }

    const res = await runSetupOperation({
      binaryPath: join(testHome, "bin", process.platform === "win32" ? "wopal.exe" : "wopal"),
      operation: "star",
      spawnFn: fakeSpawn,
    })

    expect(res.status).toBe("skipped")
    expect(res.result).toEqual({ outcome: "user-declined" })
  })

  test("runSetupOperation validates capability id and apiVersion in envelope", async () => {
    const fakeEnvelope = {
      apiVersion: "wopal.capability/v1",
      capability: "setup.operation",
      ok: true,
      data: {
        operation: "inspect",
        status: "reused",
        result: { ok: true },
      },
    }

    const fakeSpawn = () => {
      return {
        stdin: { write: () => {}, end: () => {} },
        stdout: {
          on: (event: string, cb: any) => {
            if (event === "data") cb(JSON.stringify(fakeEnvelope))
          },
        },
        stderr: { on: () => {} },
        on: (event: string, cb: any) => {
          if (event === "exit") cb(0)
        },
      } as any
    }

    const res = await runSetupOperation({
      binaryPath: join(testHome, "bin", process.platform === "win32" ? "wopal.exe" : "wopal"),
      operation: "inspect",
      spawnFn: fakeSpawn,
    })

    expect(res.status).toBe("reused")
  })

  test("runSetupOperation rejects envelope with wrong capability id", async () => {
    const fakeEnvelope = {
      apiVersion: "wopal.capability/v1",
      capability: "space.list",
      ok: true,
      data: { items: [] },
    }

    const fakeSpawn = () => {
      return {
        stdin: { write: () => {}, end: () => {} },
        stdout: {
          on: (event: string, cb: any) => {
            if (event === "data") cb(JSON.stringify(fakeEnvelope))
          },
        },
        stderr: { on: () => {} },
        on: (event: string, cb: any) => {
          if (event === "exit") cb(0)
        },
      } as any
    }

    const res = await runSetupOperation({
      binaryPath: join(testHome, "bin", process.platform === "win32" ? "wopal.exe" : "wopal"),
      operation: "inspect",
      spawnFn: fakeSpawn,
    })

    expect(res.status).toBe("failed")
    expect(res.error?.code).toBe("SETUP_RESPONSE_INVALID")
  })

  test("runSetupOperation uses 300s timeout for prepare-ontology", async () => {
    // Verify that prepare-ontology is treated as a download-class operation
    // with 300s timeout (same as install-engine)
    const fakeEnvelope = {
      apiVersion: "wopal.capability/v1",
      capability: "setup.operation",
      ok: true,
      data: {
        operation: "prepare-ontology",
        status: "created",
        result: { ontologyPath: "/tmp/onto", mode: "clone", availableTypes: [] },
      },
    }

    const fakeSpawn = () => {
      return {
        stdin: { write: () => {}, end: () => {} },
        stdout: {
          on: (event: string, cb: any) => {
            if (event === "data") cb(JSON.stringify(fakeEnvelope))
          },
        },
        stderr: { on: () => {} },
        on: (event: string, cb: any) => {
          if (event === "exit") cb(0)
        },
      } as any
    }

    const res = await runSetupOperation({
      binaryPath: join(testHome, "bin", process.platform === "win32" ? "wopal.exe" : "wopal"),
      operation: "prepare-ontology",
      spawnFn: fakeSpawn,
    })

    expect(res.status).toBe("completed")
    expect(res.result).toEqual({ ontologyPath: "/tmp/onto", mode: "clone", availableTypes: [] })
  })

  test("runSetupOperation parses error capability envelope", async () => {
    const fakeEnvelope = {
      apiVersion: "wopal.capability/v1",
      capability: "setup.operation",
      ok: false,
      error: {
        code: "SETUP_REQUEST_INVALID",
        message: "Invalid input",
        suggestion: "Choose an existing directory.",
      },
    }

    const fakeSpawn = () => {
      return {
        stdin: { write: () => {}, end: () => {} },
        stdout: {
          on: (event: string, cb: any) => {
            if (event === "data") cb(JSON.stringify(fakeEnvelope))
          },
        },
        stderr: {
          on: (event: string, cb: any) => {
            if (event === "data") cb("git worktree add failed\n")
          },
        },
        on: (event: string, cb: any) => {
          if (event === "exit") cb(1)
        },
      } as any
    }

    const res = await runSetupOperation({
      binaryPath: join(testHome, "bin", process.platform === "win32" ? "wopal.exe" : "wopal"),
      operation: "inspect",
      spawnFn: fakeSpawn,
    })

    expect(res.status).toBe("failed")
    expect(res.error?.code).toBe("SETUP_REQUEST_INVALID")
    expect(res.error?.suggestion).toBe("Choose an existing directory.")
    expect(res.error?.details).toContain("Operation: inspect")
    expect(res.error?.details).toContain("Exit code: 1")
    expect(res.error?.details).toContain("git worktree add failed")
  })

  test("runSetupOperation returns invalid for unknown CLI status", async () => {
    const fakeEnvelope = {
      apiVersion: "wopal.capability/v1",
      capability: "setup.operation",
      ok: true,
      data: {
        operation: "inspect",
        status: "unknown_status",
        result: {},
      },
    }

    const fakeSpawn = () => {
      return {
        stdin: { write: () => {}, end: () => {} },
        stdout: {
          on: (event: string, cb: any) => {
            if (event === "data") cb(JSON.stringify(fakeEnvelope))
          },
        },
        stderr: { on: () => {} },
        on: (event: string, cb: any) => {
          if (event === "exit") cb(0)
        },
      } as any
    }

    const res = await runSetupOperation({
      binaryPath: join(testHome, "bin", process.platform === "win32" ? "wopal.exe" : "wopal"),
      operation: "inspect",
      spawnFn: fakeSpawn,
    })

    expect(res.status).toBe("failed")
    expect(res.error?.code).toBe("SETUP_RESPONSE_INVALID")
  })

  test("runSetupOperation returns invalid for operation mismatch", async () => {
    const fakeEnvelope = {
      apiVersion: "wopal.capability/v1",
      capability: "setup.operation",
      ok: true,
      data: {
        operation: "install-engine",
        status: "created",
        result: {},
      },
    }

    const fakeSpawn = () => {
      return {
        stdin: { write: () => {}, end: () => {} },
        stdout: {
          on: (event: string, cb: any) => {
            if (event === "data") cb(JSON.stringify(fakeEnvelope))
          },
        },
        stderr: { on: () => {} },
        on: (event: string, cb: any) => {
          if (event === "exit") cb(0)
        },
      } as any
    }

    const res = await runSetupOperation({
      binaryPath: join(testHome, "bin", process.platform === "win32" ? "wopal.exe" : "wopal"),
      operation: "inspect",
      spawnFn: fakeSpawn,
    })

    expect(res.status).toBe("failed")
    expect(res.error?.code).toBe("SETUP_RESPONSE_INVALID")
  })
})
