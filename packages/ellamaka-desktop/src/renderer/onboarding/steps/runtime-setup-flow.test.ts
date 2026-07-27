import { describe, expect, test } from "bun:test"
import { normalizeRuntimeInspection, runRuntimeSetupFlow, type RuntimeInspection } from "./runtime-setup-flow"

describe("runtime setup flow", () => {
  test("rejects a probe payload without an explicit readiness result", () => {
    expect(normalizeRuntimeInspection({ homePath: "/tmp/.wopal" })).toEqual({
      ready: false,
      error: "检查结果缺少本体能力就绪状态。",
    })
  })

  test("checks, reconciles, and verifies in order", async () => {
    const phases: string[] = []
    const inspections: RuntimeInspection[] = [
      { ready: false, homePath: "/tmp/.wopal", capabilities: { status: "missing" } },
      { ready: true, homePath: "/tmp/.wopal", capabilities: { status: "ok" } },
    ]
    let probeCount = 0

    const outcome = await runRuntimeSetupFlow({
      probe: async () => inspections[probeCount++],
      reconcile: async () => ({
        status: "completed",
        result: {
          settingsPath: "/tmp/.wopal/config/settings.jsonc",
          capabilities: [{ capability: "agents", status: "created" }],
        },
      }),
      onPhase: (phase) => phases.push(phase),
    })

    expect(phases).toEqual(["checking", "configuring", "verifying"])
    expect(probeCount).toBe(2)
    expect(outcome.before.ready).toBe(false)
    expect(outcome.after.ready).toBe(true)
    expect(outcome.response.status).toBe("completed")
  })

  test("still reconciles an already healthy runtime and reports reuse", async () => {
    let reconcileCount = 0

    const outcome = await runRuntimeSetupFlow({
      probe: async () => ({ ready: true, homePath: "/tmp/.wopal" }),
      reconcile: async () => {
        reconcileCount += 1
        return { status: "reused", result: { capabilities: [] } }
      },
      onPhase: () => undefined,
    })

    expect(reconcileCount).toBe(1)
    expect(outcome.response.status).toBe("reused")
  })

  test("fails when the final runtime inspection is not ready", async () => {
    let probeCount = 0

    await expect(runRuntimeSetupFlow({
      probe: async () => ({ ready: probeCount++ === 0, homePath: "/tmp/.wopal" }),
      reconcile: async () => ({ status: "reused", result: {} }),
      onPhase: () => undefined,
    })).rejects.toThrow("运行时能力复检未通过")
  })
})
