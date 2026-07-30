import { spawn, type ChildProcess } from "node:child_process"

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (process.platform === "win32" && child.pid) {
    try {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      })
      killer.unref()
      return
    } catch {}
  }

  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {}
  }

  try {
    child.kill(signal)
  } catch {}
}

export async function terminateChildProcessTree(child: ChildProcess, graceMs = 1500): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return

  let exited = false
  const exitPromise = new Promise<void>((resolve) => {
    child.once("exit", () => {
      exited = true
      resolve()
    })
  })

  signalProcessTree(child, "SIGTERM")
  if (child.exitCode != null || child.signalCode != null) return
  await Promise.race([exitPromise, wait(graceMs)])

  if (!exited && child.exitCode == null && child.signalCode == null) {
    signalProcessTree(child, "SIGKILL")
    await Promise.race([exitPromise, wait(500)])
  }
}
