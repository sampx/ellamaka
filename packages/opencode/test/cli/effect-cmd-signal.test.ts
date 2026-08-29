// Subprocess tests for the effectCmd signal bridge. A CLI that suspends on
// Effect.never (serve/web shape) must exit on a single SIGINT/SIGTERM, and the
// fiber's ensuring-finalizer must run before the process dies.
//
// The bridge lives in effect-cmd.ts; this test spawns the real CLI so the
// signal path (OS signal → fiber interrupt → finalizer → exit) is exercised
// end to end.
import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The opencode package root (test/cli/ → up two levels).
const packageRoot = join(import.meta.dir, "../..")

function spawnProbe(): { proc: ReturnType<typeof spawn>; markerFile: string; probeFile: string; stderrTail(): string } {
  // Minimal effectCmd command that suspends forever with a finalizer writing
  // a marker file — the serve/web lifetime shape.
  const dir = mkdtempSync(join(tmpdir(), "effect-cmd-sig-"))
  const markerFile = join(dir, "marker")
  const stderrBuf: string[] = []
  // The probe must live inside the package so `effect` resolves to the
  // workspace version (an out-of-package probe pulls a mismatched copy and
  // dies with "Not a valid effect").
  const probeFile = join(packageRoot, "probe-effect-cmd-signal.ts")
  const probeSource = `
import { Effect } from "effect"
import { writeFileSync } from "node:fs"
import { effectCmd } from "./src/cli/effect-cmd"
const ProbeCommand = effectCmd({
  command: "probe",
  describe: false,
  instance: false,
  handler: Effect.fn("Cli.probe")(function* () {
    process.stdout.write("probe-ready\\n")
    yield* Effect.never.pipe(
      Effect.ensuring(Effect.sync(() => writeFileSync(${JSON.stringify(markerFile)}, "disposed"))),
    )
  }),
})
import yargs from "yargs"
yargs(process.argv.slice(2)).command(ProbeCommand).demandCommand(1).parseAsync().then(() => {
  // Serve/web shape: index.ts's finally block calls process.exit() after the
  // handler settles; the probe mirrors that explicit exit.
  process.exit(0)
}).catch((e) => {
  process.stderr.write("PARSE-REJECT: " + String(e).slice(0, 300) + "\\n")
  process.exit(2)
})
`
  writeFileSync(probeFile, probeSource)
  const proc = spawn(process.execPath, ["--conditions=browser", probeFile, "probe"], {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"],
  })
  proc.stderr!.on("data", (chunk: Buffer) => stderrBuf.push(chunk.toString()))
  return { proc, markerFile, probeFile, stderrTail: () => stderrBuf.join("").slice(-2500) }
}

function waitForOutput(proc: ReturnType<typeof spawn>, text: string, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const stderr: string[] = []
    proc.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk.toString()))
    const timer = setTimeout(() => {
      reject(new Error(`timeout waiting for ${text}\nstderr tail:\n${stderr.join("").slice(-1500)}`))
    }, timeoutMs)
    proc.stdout!.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes(text)) {
        clearTimeout(timer)
        resolve()
      }
    })
    proc.on("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`probe exited early (code=${code})\nstderr tail:\n${stderr.join("").slice(-2500)}`))
    })
  })
}

async function settled(proc: ReturnType<typeof spawn>): Promise<number | null> {
  return await new Promise((resolve) => {
    if (proc.exitCode !== null) return resolve(proc.exitCode)
    proc.on("exit", (code) => resolve(code))
  })
}

describe("effectCmd signal bridge (subprocess)", () => {
  const signals = ["SIGINT", "SIGTERM"] as const
  for (const signal of signals) {
    test(`single ${signal} exits the suspended command and runs the finalizer`, async () => {
      const { proc, markerFile, probeFile, stderrTail } = spawnProbe()
      try {
        await waitForOutput(proc, "probe-ready")

        const started = Date.now()
        proc.kill(signal)
        const code = await settled(proc)
        const elapsed = Date.now() - started

        expect(elapsed, `exit should be prompt after ${signal}`).toBeLessThan(10_000)
        try {
          expect(readFileSync(markerFile, "utf-8"), "finalizer should have run").toBe("disposed")
        } catch (e) {
          throw new Error(`marker assertion failed (exit=${code})\nstderr tail:\n${stderrTail()}`, { cause: e })
        }
        expect(code, `process should exit 0 after one ${signal}`).toBe(0)
      } finally {
        rmSync(probeFile, { force: true })
      }
    }, 30_000)
  }
})
