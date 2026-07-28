export type RuntimePhase = "checking" | "configuring" | "verifying"

export interface RuntimeInspection {
  ready: boolean
  homePath?: string
  settingsPath?: string
  error?: string
  config?: {
    status?: string
    presentKeys?: string[]
    missingKeys?: string[]
  }
  scripts?: {
    status?: string
    binPath?: string
    expected?: string[]
    present?: string[]
    missing?: string[]
    stale?: string[]
  }
  capabilities?: {
    status?: string
    expected?: string[]
    present?: string[]
    missing?: string[]
    empty?: string[]
    stale?: string[]
  }
}

export interface RuntimeSetupResult {
  settingsPath?: string
  scriptsBinPath?: string
  config?: { status?: string; presentKeys?: string[] }
  scripts?: { status?: string; synced?: string[]; warnings?: string[] }
  capabilities?: Array<{ capability?: string; status?: string; message?: string }>
}

export interface RuntimeStepResponse {
  status: "completed" | "reused" | "skipped" | "failed"
  result?: RuntimeSetupResult
  error?: { message?: string }
}

export interface RuntimeSetupFlowOutcome {
  before: RuntimeInspection
  after: RuntimeInspection
  response: RuntimeStepResponse
}

export function normalizeRuntimeInspection(value: unknown): RuntimeInspection {
  if (!value || typeof value !== "object" || typeof (value as { ready?: unknown }).ready !== "boolean") {
    return { ready: false, error: "检查结果缺少本体能力就绪状态。" }
  }
  return value as RuntimeInspection
}

export async function runRuntimeSetupFlow(input: {
  probe: () => Promise<RuntimeInspection>
  reconcile: () => Promise<RuntimeStepResponse>
  onPhase: (phase: RuntimePhase, inspection?: RuntimeInspection) => void
}): Promise<RuntimeSetupFlowOutcome> {
  input.onPhase("checking")
  const before = await input.probe()
  if (before.error) throw new Error(before.error)

  input.onPhase("configuring", before)
  const response = await input.reconcile()
  if (response.status !== "completed" && response.status !== "reused") {
    const msg = response.error?.message ?? "本体能力安装配置失败。"
    // Provide actionable guidance when ontology was not prepared
    if (msg.includes("SETUP_ONTOLOGY_NOT_PREPARED") || msg.includes("prepare-ontology")) {
      throw new Error("能力模板库尚未准备，请先完成「能力与模型」阶段的能力模板库步骤，再回到本步骤。")
    }
    throw new Error(msg)
  }

  input.onPhase("verifying")
  const after = await input.probe()
  if (after.error) throw new Error(after.error)
  if (!after.ready) throw new Error("运行时能力复检未通过，请重试。")

  return { before, after, response }
}
