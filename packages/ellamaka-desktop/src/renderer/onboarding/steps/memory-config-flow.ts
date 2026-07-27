/**
 * Memory configuration flow — pure functions for probe normalization,
 * form initialization, validation, payload construction, and result
 * summary. No UI or IPC dependencies.
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface MemoryProbeResult {
  state: "unconfigured" | "disabled" | "incomplete" | "ready"
  enabled: boolean
  envPath: string
  llmEndpoint: string
  llmModel: string
  llmKeyConfigured: boolean
  embeddingEndpoint: string
  embeddingModel: string
  embeddingKeyConfigured: boolean
  error?: string | null
}

export interface MemoryFormState {
  enabled: boolean
  llmEndpoint: string
  llmModel: string
  llmKey: string
  embeddingEndpoint: string
  embeddingModel: string
  embeddingKey: string
  reuseEmbedding: boolean
  llmKeyConfigured: boolean
  embeddingKeyConfigured: boolean
}

export interface MemoryFormErrors {
  llmEndpoint?: string
  llmKey?: string
  llmModel?: string
  embeddingEndpoint?: string
  embeddingModel?: string
}

export interface MemoryPayload {
  enabled: boolean
  llmEndpoint?: string
  llmKey?: string
  llmModel?: string
  embeddingEndpoint?: string
  embeddingKey?: string
  embeddingModel?: string
}

export interface MemoryResultSummary {
  enabled: boolean
  state: string
  outcome: string
  envPath: string
  llmEndpoint: string
  llmModel: string
  llmKeySaved: boolean
  embeddingEndpoint: string
  embeddingModel: string
  embeddingKeySaved: boolean
}

// ── normalizeMemoryProbe ───────────────────────────────────────────────

/**
 * Normalize the raw probe response into a typed MemoryProbeResult.
 * Handles missing/partial data gracefully.
 */
export function normalizeMemoryProbe(
  raw: Record<string, unknown> | null | undefined,
): MemoryProbeResult {
  const nested = raw?.memory
  const mem = nested && typeof nested === "object"
    ? nested as Record<string, unknown>
    : (raw ?? {})
  const llm = (mem.llm ?? {}) as Record<string, unknown>
  const emb = (mem.embedding ?? {}) as Record<string, unknown>
  const states: MemoryProbeResult["state"][] = ["unconfigured", "disabled", "incomplete", "ready"]
  const state = states.includes(mem.state as MemoryProbeResult["state"])
    ? mem.state as MemoryProbeResult["state"]
    : "unconfigured"

  return {
    state,
    enabled: Boolean(mem.enabled),
    envPath: String(mem.envPath ?? ""),
    llmEndpoint: String(llm.endpoint ?? ""),
    llmModel: String(llm.model ?? ""),
    llmKeyConfigured: Boolean(llm.keyConfigured),
    embeddingEndpoint: String(emb.endpoint ?? ""),
    embeddingModel: String(emb.model ?? ""),
    embeddingKeyConfigured: Boolean(emb.keyConfigured),
    error: typeof raw?.error === "string" ? raw.error : null,
  }
}

// ── buildInitialForm ───────────────────────────────────────────────────

/**
 * Build the initial form state from a probe result.
 * - Fresh/unconfigured: defaults to enabled, LLM model = gpt-4o-mini
 * - Disabled: pre-fills existing values, switch off
 * - Ready/incomplete: pre-fills existing values, switch on
 * - Auto-detects reuseEmbedding when both endpoints are non-empty and equal
 */
export function buildInitialForm(probe: MemoryProbeResult): MemoryFormState {
  const isFresh = probe.state === "unconfigured"

  const llmEndpoint = isFresh ? "" : probe.llmEndpoint
  const llmModel = isFresh ? "gpt-4o-mini" : probe.llmModel
  const embeddingEndpoint = isFresh ? "" : probe.embeddingEndpoint
  const embeddingModel = isFresh ? "" : probe.embeddingModel

  const reuseEmbedding = isFresh || (
    llmEndpoint.length > 0 &&
    embeddingEndpoint.length > 0 &&
    llmEndpoint === embeddingEndpoint
  )

  return {
    enabled: isFresh ? true : probe.enabled,
    llmEndpoint,
    llmModel,
    llmKey: "",
    embeddingEndpoint,
    embeddingModel,
    embeddingKey: "",
    reuseEmbedding,
    llmKeyConfigured: probe.llmKeyConfigured,
    embeddingKeyConfigured: probe.embeddingKeyConfigured,
  }
}

// ── validateMemoryForm ─────────────────────────────────────────────────

const URL_PATTERN = /^https?:\/\/.+/i

/**
 * Validate the form state. Returns null if valid, or an object with
 * per-field error messages. Only validates when enabled.
 */
export function validateMemoryForm(
  form: MemoryFormState,
): MemoryFormErrors | null {
  if (!form.enabled) return null

  const errors: MemoryFormErrors = {}

  // LLM endpoint: required, must be a valid URL
  if (!form.llmEndpoint.trim()) {
    errors.llmEndpoint = "请输入 LLM API 端点地址"
  } else if (!URL_PATTERN.test(form.llmEndpoint.trim())) {
    errors.llmEndpoint = "请输入有效的 URL（以 http:// 或 https:// 开头）"
  }

  // LLM key: required if not already configured
  if (!form.llmKey.trim() && !form.llmKeyConfigured) {
    errors.llmKey = "请输入 LLM API Key"
  }

  // LLM model: required
  if (!form.llmModel.trim()) {
    errors.llmModel = "请输入 LLM 模型名称"
  }

  // Embedding endpoint: required unless reuse is on
  if (!form.reuseEmbedding) {
    if (!form.embeddingEndpoint.trim()) {
      errors.embeddingEndpoint = "请输入 Embedding API 端点地址"
    } else if (!URL_PATTERN.test(form.embeddingEndpoint.trim())) {
      errors.embeddingEndpoint = "请输入有效的 URL（以 http:// 或 https:// 开头）"
    }
  }

  // Embedding model: always required
  if (!form.embeddingModel.trim()) {
    errors.embeddingModel = "请输入 Embedding 模型名称"
  }

  return Object.keys(errors).length > 0 ? errors : null
}

// ── buildMemoryPayload ─────────────────────────────────────────────────

/**
 * Build the IPC payload from the form state.
 * - Disabled: only sends { enabled: false }
 * - Enabled: sends all non-empty fields
 * - Keys: only sent when user typed a new value; empty = keep existing
 * - Reuse mode: copies llmEndpoint/llmKey to embedding when applicable
 */
export function buildMemoryPayload(form: MemoryFormState): MemoryPayload {
  if (!form.enabled) {
    return { enabled: false }
  }

  const payload: MemoryPayload = {
    enabled: true,
    llmEndpoint: form.llmEndpoint.trim() || undefined,
    llmModel: form.llmModel.trim() || undefined,
  }

  // LLM key: only send if user typed a new one
  if (form.llmKey.trim()) {
    payload.llmKey = form.llmKey.trim()
  }

  if (form.reuseEmbedding) {
    // Reuse: embedding endpoint = llm endpoint
    payload.embeddingEndpoint = form.llmEndpoint.trim() || undefined
    // If user typed a new LLM key, also use it for embedding
    if (form.llmKey.trim()) {
      payload.embeddingKey = form.llmKey.trim()
    }
  } else {
    if (form.embeddingEndpoint.trim()) {
      payload.embeddingEndpoint = form.embeddingEndpoint.trim()
    }
    if (form.embeddingKey.trim()) {
      payload.embeddingKey = form.embeddingKey.trim()
    }
  }

  if (form.embeddingModel.trim()) {
    payload.embeddingModel = form.embeddingModel.trim()
  }

  return payload
}

// ── buildMemoryResultSummary ───────────────────────────────────────────

/**
 * Build a display-friendly result summary from the operation result.
 * Never includes actual key values.
 */
export function buildMemoryResultSummary(
  result: Record<string, unknown>,
): MemoryResultSummary {
  return {
    enabled: Boolean(result.memoryEnabled),
    state: String(result.state ?? "unknown"),
    outcome: String(result.outcome ?? "unknown"),
    envPath: String(result.envPath ?? ""),
    llmEndpoint: String(result.llmEndpoint ?? ""),
    llmModel: String(result.llmModel ?? ""),
    llmKeySaved: Boolean(result.llmKeyConfigured),
    embeddingEndpoint: String(result.embeddingEndpoint ?? ""),
    embeddingModel: String(result.embeddingModel ?? ""),
    embeddingKeySaved: Boolean(result.embeddingKeyConfigured),
  }
}

export function isMemoryProbeSatisfied(
  probe: MemoryProbeResult,
  expectedEnabled: boolean,
): boolean {
  if (probe.error) return false
  return expectedEnabled
    ? probe.state === "ready" && probe.enabled
    : probe.state === "disabled" && !probe.enabled
}
