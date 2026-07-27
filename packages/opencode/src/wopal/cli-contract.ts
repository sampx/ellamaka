import { existsSync } from "fs"
import path from "path"
import semver from "semver"
import { Context, Duration, Effect, Layer, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
export const MIN_WOPAL_CLI_VERSION = process.env.MIN_WOPAL_CLI_VERSION || "0.3.4"

export const CliHealthSchema = Schema.Struct({
  state: Schema.Union([
    Schema.Literal("ok"),
    Schema.Literal("missing"),
    Schema.Literal("incompatible"),
    Schema.Literal("broken"),
  ]),
  requiredVersion: Schema.String,
  actualVersion: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
})

export type CliHealth = typeof CliHealthSchema.Type

export const CliRepairSchema = Schema.Struct({
  started: Schema.Boolean,
  cli: CliHealthSchema,
  message: Schema.optional(Schema.String),
})

export type CliRepair = typeof CliRepairSchema.Type

export function executablePath() {
  return path.join(Global.Path.wopalHome, "bin", process.platform === "win32" ? "wopal.exe" : "wopal")
}

export function classifyWopalCliVersion(actualVersion: string): CliHealth {
  const normalized = semver.valid(actualVersion)
  if (!normalized) {
    return {
      state: "broken",
      requiredVersion: MIN_WOPAL_CLI_VERSION,
      actualVersion,
    }
  }

  return {
    state: semver.gte(normalized, MIN_WOPAL_CLI_VERSION) ? "ok" : "incompatible",
    requiredVersion: MIN_WOPAL_CLI_VERSION,
    actualVersion,
  }
}

export interface Interface {
  readonly inspect: () => Effect.Effect<CliHealth>
  readonly repair: () => Effect.Effect<CliRepair>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CliContract") {}

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  const run = (command: string, args: string[]) =>
    Effect.gen(function* () {
      const child = yield* spawner.spawn(ChildProcess.make(command, args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" }))
      return yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(child.stdout)),
          Stream.mkString(Stream.decodeText(child.stderr)),
          child.exitCode,
        ],
        { concurrency: 3 },
      )
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: "2 minutes",
        orElse: () => Effect.fail(new Error(`CLI command timed out: ${command}`)),
      }),
    )

  const inspectNow = (): Effect.Effect<CliHealth> => {
    const executable = executablePath()
    if (!existsSync(executable)) {
      return Effect.succeed({ state: "missing", requiredVersion: MIN_WOPAL_CLI_VERSION })
    }

    return run(executable, ["--version"]).pipe(
      Effect.map(([stdout, stderr, exitCode]) => {
        if (exitCode !== 0) {
          return {
            state: "broken" as const,
            requiredVersion: MIN_WOPAL_CLI_VERSION,
            reason: stderr.trim() || `wopal --version exited with code ${exitCode}`,
          }
        }
        return classifyWopalCliVersion(stdout.trim())
      }),
      Effect.catch((cause) =>
        Effect.succeed({
          state: "broken" as const,
          requiredVersion: MIN_WOPAL_CLI_VERSION,
          reason: String(cause),
        }),
      ),
    )
  }

  // 启动时仅检测一次 CLI 状态并永久复用缓存，避免定时轮询反复 spawn 子进程
  // 当运行 CLI 修复 (repair) 成功后触发 invalidateInspect 作废缓存并重新检测
  const [cachedInspect, invalidateInspect] = yield* Effect.cachedInvalidateWithTTL(inspectNow(), Duration.infinity)
  const inspect = (): Effect.Effect<CliHealth> => cachedInspect

  const install = () => {
    if (process.platform === "win32") {
      return run("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "& ([scriptblock]::Create((Invoke-RestMethod https://wopal.cn/install.ps1))) -UpdateOnly -Force",
      ])
    }

    return run("bash", ["-lc", "curl -fsSL https://wopal.cn/install.sh | bash -s -- --force --no-modify-path"])
  }

  const repair = (): Effect.Effect<CliRepair> =>
    inspect().pipe(
      Effect.flatMap((before) => {
        if (before.state === "ok") return Effect.succeed({ started: false, cli: before })

        const update =
          before.state === "incompatible"
            ? run(executablePath(), ["update"]).pipe(
                Effect.flatMap((result) => result[2] === 0 ? Effect.succeed(result) : install()),
                Effect.catch(() => install()),
              )
            : install()

        return update.pipe(
          Effect.flatMap(([, stderr, exitCode]) => {
            if (exitCode !== 0) {
              return Effect.succeed({
                started: false,
                cli: before,
                message: stderr.trim() || "Wopal CLI repair failed",
              })
            }
            return Effect.gen(function* () {
              yield* invalidateInspect
              return { started: true, cli: yield* inspect() }
            })
          }),
          Effect.catch((cause) =>
            Effect.succeed({
              started: false,
              cli: before,
              message: String(cause),
            }),
          ),
        )
      }),
    )

  return Service.of({ inspect, repair })
})

export const layer = Layer.effect(Service, make)

export const defaultLayer = layer.pipe(Layer.provide(CrossSpawnSpawner.defaultLayer))

export * as CliContract from "./cli-contract"
