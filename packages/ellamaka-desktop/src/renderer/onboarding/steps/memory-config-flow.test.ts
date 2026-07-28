import { describe, expect, test } from "bun:test"
import {
  normalizeMemoryProbe,
  buildInitialForm,
  validateMemoryForm,
  buildMemoryPayload,
  buildMemoryResultSummary,
  isMemoryProbeSatisfied,
  type MemoryProbeResult,
  type MemoryFormState,
  type MemoryFormErrors,
} from "./memory-config-flow"

// ── normalizeMemoryProbe ──────────────────────────────────────────────

describe("memory-config-flow | normalizeMemoryProbe", () => {
  test("unconfigured when probe returns no memory field", () => {
    const result = normalizeMemoryProbe({})
    expect(result.state).toBe("unconfigured")
    expect(result.enabled).toBe(false)
    expect(result.llmEndpoint).toBe("")
    expect(result.llmKeyConfigured).toBe(false)
    expect(result.embeddingEndpoint).toBe("")
    expect(result.embeddingKeyConfigured).toBe(false)
  })

  test("unconfigured when probe returns null", () => {
    const result = normalizeMemoryProbe(null as any)
    expect(result.state).toBe("unconfigured")
  })

  test("disabled state from probe", () => {
    const result = normalizeMemoryProbe({
      memory: {
        state: "disabled",
        enabled: false,
        injectionEnabled: false,
        envPath: "/tmp/.env",
        llm: { endpoint: "https://api.example.com", model: "gpt-4", keyConfigured: true },
        embedding: { endpoint: "https://api.example.com", model: "text-embedding-3-small", keyConfigured: false },
      },
    })
    expect(result.state).toBe("disabled")
    expect(result.enabled).toBe(false)
    expect(result.llmEndpoint).toBe("https://api.example.com")
    expect(result.llmKeyConfigured).toBe(true)
  })

  test("ready state from probe", () => {
    const result = normalizeMemoryProbe({
      memory: {
        state: "ready",
        enabled: true,
        injectionEnabled: true,
        envPath: "/tmp/.env",
        llm: { endpoint: "https://api.example.com", model: "gpt-4o", keyConfigured: true },
        embedding: { endpoint: "https://api.example.com", model: "text-embedding-3-small", keyConfigured: true },
      },
    })
    expect(result.state).toBe("ready")
    expect(result.enabled).toBe(true)
    expect(result.llmModel).toBe("gpt-4o")
    expect(result.embeddingModel).toBe("text-embedding-3-small")
  })

  test("accepts the direct memory object returned by Desktop probe", () => {
    const result = normalizeMemoryProbe({
      state: "ready",
      enabled: true,
      envPath: "/tmp/.env",
      llm: { endpoint: "https://api.example.com", model: "gpt-4o", keyConfigured: true },
      embedding: { endpoint: "https://api.example.com", model: "text-embedding-3-small", keyConfigured: false },
    })

    expect(result.state).toBe("ready")
    expect(result.llmKeyConfigured).toBe(true)
  })

  test("incomplete state from probe", () => {
    const result = normalizeMemoryProbe({
      memory: {
        state: "incomplete",
        enabled: true,
        injectionEnabled: false,
        envPath: "/tmp/.env",
        llm: { endpoint: "https://api.example.com", model: null, keyConfigured: false },
        embedding: { endpoint: null, model: null, keyConfigured: false },
      },
    })
    expect(result.state).toBe("incomplete")
    expect(result.enabled).toBe(true)
  })

  test("preserves a probe error instead of treating it as fresh config", () => {
    const result = normalizeMemoryProbe({ error: "检查失败" })

    expect(result.error).toBe("检查失败")
  })

  test("normalizes an unknown state to unconfigured", () => {
    const result = normalizeMemoryProbe({ memory: { state: "invalid" } })

    expect(result.state).toBe("unconfigured")
  })

  test("never leaks keys from probe", () => {
    const result = normalizeMemoryProbe({
      memory: {
        state: "ready",
        enabled: true,
        injectionEnabled: true,
        envPath: "/tmp/.env",
        llm: { endpoint: "https://api.example.com", model: "gpt-4", keyConfigured: true },
        embedding: { endpoint: "https://api.example.com", model: "text-embedding-3-small", keyConfigured: true },
      },
    })
    const str = JSON.stringify(result)
    expect(str).not.toContain("sk-")
    expect(str).not.toContain("apiKey")
  })
})

// ── buildInitialForm ──────────────────────────────────────────────────

describe("memory-config-flow | buildInitialForm", () => {
  test("fresh state defaults to enabled with gpt-4o-mini", () => {
    const probe: MemoryProbeResult = {
      state: "unconfigured",
      enabled: false,
      envPath: "/tmp/.env",
      llmEndpoint: "",
      llmModel: "",
      llmKeyConfigured: false,
      embeddingEndpoint: "",
      embeddingModel: "",
      embeddingKeyConfigured: false,
    }
    const form = buildInitialForm(probe)
    expect(form.enabled).toBe(false)
    expect(form.llmModel).toBe("gpt-4o-mini")
    expect(form.llmEndpoint).toBe("")
    expect(form.llmKey).toBe("")
    expect(form.embeddingModel).toBe("")
    expect(form.reuseEmbedding).toBe(true)
  })

  test("disabled state pre-fills with existing values", () => {
    const probe: MemoryProbeResult = {
      state: "disabled",
      enabled: false,
      envPath: "/tmp/.env",
      llmEndpoint: "https://api.example.com",
      llmModel: "gpt-4",
      llmKeyConfigured: true,
      embeddingEndpoint: "https://api.example.com",
      embeddingModel: "text-embedding-3-small",
      embeddingKeyConfigured: false,
    }
    const form = buildInitialForm(probe)
    expect(form.enabled).toBe(false)
    expect(form.llmEndpoint).toBe("https://api.example.com")
    expect(form.llmModel).toBe("gpt-4")
    expect(form.llmKey).toBe("")
    expect(form.embeddingEndpoint).toBe("https://api.example.com")
    expect(form.embeddingModel).toBe("text-embedding-3-small")
    expect(form.reuseEmbedding).toBe(true) // endpoints match
  })

  test("ready state pre-fills and auto-detects reuse when endpoints match", () => {
    const probe: MemoryProbeResult = {
      state: "ready",
      enabled: true,
      envPath: "/tmp/.env",
      llmEndpoint: "https://api.openai.com/v1",
      llmModel: "gpt-4o",
      llmKeyConfigured: true,
      embeddingEndpoint: "https://api.openai.com/v1",
      embeddingModel: "text-embedding-3-small",
      embeddingKeyConfigured: true,
    }
    const form = buildInitialForm(probe)
    expect(form.enabled).toBe(true)
    expect(form.reuseEmbedding).toBe(true)
    expect(form.embeddingEndpoint).toBe("https://api.openai.com/v1")
  })

  test("does not auto-detect reuse when endpoints differ", () => {
    const probe: MemoryProbeResult = {
      state: "ready",
      enabled: true,
      envPath: "/tmp/.env",
      llmEndpoint: "https://api.openai.com/v1",
      llmModel: "gpt-4o",
      llmKeyConfigured: true,
      embeddingEndpoint: "https://other.example.com",
      embeddingModel: "text-embedding-3-small",
      embeddingKeyConfigured: false,
    }
    const form = buildInitialForm(probe)
    expect(form.reuseEmbedding).toBe(false)
  })
})

// ── validateMemoryForm ────────────────────────────────────────────────

describe("memory-config-flow | validateMemoryForm", () => {
  test("no errors when disabled", () => {
    const form: MemoryFormState = {
      enabled: false,
      llmEndpoint: "",
      llmModel: "",
      llmKey: "",
      embeddingEndpoint: "",
      embeddingModel: "",
      embeddingKey: "",
      reuseEmbedding: false,
      llmKeyConfigured: false,
      embeddingKeyConfigured: false,
    }
    const errors = validateMemoryForm(form)
    expect(errors).toBeNull()
  })

  test("validates required fields when enabled", () => {
    const form: MemoryFormState = {
      enabled: true,
      llmEndpoint: "",
      llmModel: "",
      llmKey: "",
      embeddingEndpoint: "",
      embeddingModel: "",
      embeddingKey: "",
      reuseEmbedding: false,
      llmKeyConfigured: false,
      embeddingKeyConfigured: false,
    }
    const errors = validateMemoryForm(form)
    expect(errors).not.toBeNull()
    expect(errors!.llmEndpoint).toBeDefined()
    expect(errors!.llmKey).toBeDefined()
    expect(errors!.embeddingEndpoint).toBeDefined()
    expect(errors!.embeddingModel).toBeDefined()
  })

  test("accepts when all required fields present", () => {
    const form: MemoryFormState = {
      enabled: true,
      llmEndpoint: "https://api.example.com",
      llmModel: "gpt-4o-mini",
      llmKey: "sk-new",
      embeddingEndpoint: "https://api.example.com",
      embeddingModel: "text-embedding-3-small",
      embeddingKey: "",
      reuseEmbedding: false,
      llmKeyConfigured: false,
      embeddingKeyConfigured: false,
    }
    const errors = validateMemoryForm(form)
    expect(errors).toBeNull()
  })

  test("accepts when key is already configured (no new key input)", () => {
    const form: MemoryFormState = {
      enabled: true,
      llmEndpoint: "https://api.example.com",
      llmModel: "gpt-4o-mini",
      llmKey: "",
      embeddingEndpoint: "https://api.example.com",
      embeddingModel: "text-embedding-3-small",
      embeddingKey: "",
      reuseEmbedding: false,
      llmKeyConfigured: true,
      embeddingKeyConfigured: false,
    }
    const errors = validateMemoryForm(form)
    expect(errors).toBeNull()
  })

  test("rejects invalid URL format", () => {
    const form: MemoryFormState = {
      enabled: true,
      llmEndpoint: "not-a-url",
      llmModel: "gpt-4o-mini",
      llmKey: "sk-test",
      embeddingEndpoint: "https://api.example.com",
      embeddingModel: "text-embedding-3-small",
      embeddingKey: "",
      reuseEmbedding: false,
      llmKeyConfigured: false,
      embeddingKeyConfigured: false,
    }
    const errors = validateMemoryForm(form)
    expect(errors).not.toBeNull()
    expect(errors!.llmEndpoint).toBeDefined()
  })

  test("rejects empty embedding model", () => {
    const form: MemoryFormState = {
      enabled: true,
      llmEndpoint: "https://api.example.com",
      llmModel: "gpt-4o-mini",
      llmKey: "sk-test",
      embeddingEndpoint: "https://api.example.com",
      embeddingModel: "",
      embeddingKey: "",
      reuseEmbedding: false,
      llmKeyConfigured: false,
      embeddingKeyConfigured: false,
    }
    const errors = validateMemoryForm(form)
    expect(errors).not.toBeNull()
    expect(errors!.embeddingModel).toBeDefined()
  })

  test("reuse mode: embedding endpoint not required when reuse is on", () => {
    const form: MemoryFormState = {
      enabled: true,
      llmEndpoint: "https://api.example.com",
      llmModel: "gpt-4o-mini",
      llmKey: "sk-test",
      embeddingEndpoint: "",
      embeddingModel: "text-embedding-3-small",
      embeddingKey: "",
      reuseEmbedding: true,
      llmKeyConfigured: false,
      embeddingKeyConfigured: false,
    }
    const errors = validateMemoryForm(form)
    // In reuse mode, embedding endpoint is inherited from LLM
    expect(errors).toBeNull()
  })
})

// ── buildMemoryPayload ────────────────────────────────────────────────

describe("memory-config-flow | buildMemoryPayload", () => {
  test("builds full payload for enabled config", () => {
    const form: MemoryFormState = {
      enabled: true,
      llmEndpoint: "https://api.example.com",
      llmModel: "gpt-4o-mini",
      llmKey: "sk-new-key",
      embeddingEndpoint: "https://api.example.com",
      embeddingModel: "text-embedding-3-small",
      embeddingKey: "emb-key",
      reuseEmbedding: false,
      llmKeyConfigured: false,
      embeddingKeyConfigured: false,
    }
    const payload = buildMemoryPayload(form)
    expect(payload.enabled).toBe(true)
    expect(payload.llmEndpoint).toBe("https://api.example.com")
    expect(payload.llmKey).toBe("sk-new-key")
    expect(payload.llmModel).toBe("gpt-4o-mini")
    expect(payload.embeddingEndpoint).toBe("https://api.example.com")
    expect(payload.embeddingKey).toBe("emb-key")
    expect(payload.embeddingModel).toBe("text-embedding-3-small")
  })

  test("omits key when not provided and already configured", () => {
    const form: MemoryFormState = {
      enabled: true,
      llmEndpoint: "https://api.example.com",
      llmModel: "gpt-4o-mini",
      llmKey: "",
      embeddingEndpoint: "https://api.example.com",
      embeddingModel: "text-embedding-3-small",
      embeddingKey: "",
      reuseEmbedding: false,
      llmKeyConfigured: true,
      embeddingKeyConfigured: true,
    }
    const payload = buildMemoryPayload(form)
    expect(payload.llmKey).toBeUndefined()
    expect(payload.embeddingKey).toBeUndefined()
  })

  test("reuse mode: copies llmKey to embeddingKey when new key provided", () => {
    const form: MemoryFormState = {
      enabled: true,
      llmEndpoint: "https://api.example.com",
      llmModel: "gpt-4o-mini",
      llmKey: "sk-new-key",
      embeddingEndpoint: "",
      embeddingModel: "text-embedding-3-small",
      embeddingKey: "",
      reuseEmbedding: true,
      llmKeyConfigured: false,
      embeddingKeyConfigured: false,
    }
    const payload = buildMemoryPayload(form)
    expect(payload.embeddingKey).toBe("sk-new-key")
    expect(payload.embeddingEndpoint).toBe("https://api.example.com")
  })

  test("reuse mode: does not copy empty llmKey to embeddingKey", () => {
    const form: MemoryFormState = {
      enabled: true,
      llmEndpoint: "https://api.example.com",
      llmModel: "gpt-4o-mini",
      llmKey: "",
      embeddingEndpoint: "",
      embeddingModel: "text-embedding-3-small",
      embeddingKey: "",
      reuseEmbedding: true,
      llmKeyConfigured: true,
      embeddingKeyConfigured: true,
    }
    const payload = buildMemoryPayload(form)
    expect(payload.embeddingKey).toBeUndefined()
    expect(payload.embeddingEndpoint).toBe("https://api.example.com")
  })

  test("disabled payload only has enabled: false", () => {
    const form: MemoryFormState = {
      enabled: false,
      llmEndpoint: "https://api.example.com",
      llmModel: "gpt-4",
      llmKey: "",
      embeddingEndpoint: "https://api.example.com",
      embeddingModel: "text-embedding-3-small",
      embeddingKey: "",
      reuseEmbedding: false,
      llmKeyConfigured: true,
      embeddingKeyConfigured: false,
    }
    const payload = buildMemoryPayload(form)
    expect(payload.enabled).toBe(false)
    expect(payload.llmEndpoint).toBeUndefined()
    expect(payload.llmKey).toBeUndefined()
  })
})

// ── buildMemoryResultSummary ───────────────────────────────────────────

describe("memory-config-flow | buildMemoryResultSummary", () => {
  test("builds summary from operation result", () => {
    const result: Record<string, unknown> = {
      memoryEnabled: true,
      state: "ready",
      envPath: "/tmp/.env",
      outcome: "created",
      llmEndpoint: "https://api.example.com",
      llmModel: "gpt-4o-mini",
      llmKeyConfigured: true,
      embeddingEndpoint: "https://api.example.com",
      embeddingModel: "text-embedding-3-small",
      embeddingKeyConfigured: true,
    }
    const summary = buildMemoryResultSummary(result)
    expect(summary.enabled).toBe(true)
    expect(summary.state).toBe("ready")
    expect(summary.outcome).toBe("created")
    expect(summary.llmEndpoint).toBe("https://api.example.com")
    expect(summary.llmKeySaved).toBe(true)
    expect(summary.embeddingKeySaved).toBe(true)
  })

  test("handles disabled state", () => {
    const result: Record<string, unknown> = {
      memoryEnabled: false,
      state: "disabled",
      envPath: "/tmp/.env",
      outcome: "reused",
    }
    const summary = buildMemoryResultSummary(result)
    expect(summary.enabled).toBe(false)
    expect(summary.state).toBe("disabled")
  })

  test("never leaks keys in summary", () => {
    const result: Record<string, unknown> = {
      memoryEnabled: true,
      state: "ready",
      envPath: "/tmp/.env",
      outcome: "created",
      llmEndpoint: "https://api.example.com",
      llmModel: "gpt-4o-mini",
      llmKeyConfigured: true,
      embeddingEndpoint: "https://api.example.com",
      embeddingModel: "text-embedding-3-small",
      embeddingKeyConfigured: true,
    }
    const summary = buildMemoryResultSummary(result)
    const str = JSON.stringify(summary)
    expect(str).not.toContain("sk-")
    expect(str).not.toContain("apiKey")
  })
})

describe("memory-config-flow | isMemoryProbeSatisfied", () => {
  const base: MemoryProbeResult = {
    state: "ready",
    enabled: true,
    envPath: "/tmp/.env",
    llmEndpoint: "https://api.example.com",
    llmModel: "gpt-4o-mini",
    llmKeyConfigured: true,
    embeddingEndpoint: "https://api.example.com",
    embeddingModel: "text-embedding-3-small",
    embeddingKeyConfigured: false,
    error: null,
  }

  test("accepts ready after enabling", () => {
    expect(isMemoryProbeSatisfied(base, true)).toBe(true)
  })

  test("accepts disabled after disabling", () => {
    expect(isMemoryProbeSatisfied({ ...base, state: "disabled", enabled: false }, false)).toBe(true)
  })

  test("rejects incomplete or failed verification", () => {
    expect(isMemoryProbeSatisfied({ ...base, state: "incomplete" }, true)).toBe(false)
    expect(isMemoryProbeSatisfied({ ...base, error: "检查失败" }, true)).toBe(false)
  })
})
