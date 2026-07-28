import { createSignal, onMount, Show } from "solid-js"
import { ProgressDisplay } from "../components/ProgressDisplay"
import { zhCN } from "../content/zh-CN"
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
  type MemoryResultSummary,
} from "./memory-config-flow"

export interface StepProps {
  onStatusChange?: (status: "working" | "success" | "error") => void
  onComplete: () => void
  onError: (msg: string | null) => void
}

export function MemoryConfigStep(props: StepProps) {
  const t = zhCN.memory

  const [probing, setProbing] = createSignal(true)
  const [submitting, setSubmitting] = createSignal(false)
  const [resultSummary, setResultSummary] = createSignal<MemoryResultSummary | null>(null)
  const [probeError, setProbeError] = createSignal<string | null>(null)

  // Form state
  const [enabled, setEnabled] = createSignal(true)
  const [llmEndpoint, setLlmEndpoint] = createSignal("")
  const [llmModel, setLlmModel] = createSignal("")
  const [llmKey, setLlmKey] = createSignal("")
  const [embeddingEndpoint, setEmbeddingEndpoint] = createSignal("")
  const [embeddingModel, setEmbeddingModel] = createSignal("")
  const [embeddingKey, setEmbeddingKey] = createSignal("")
  const [reuseEmbedding, setReuseEmbedding] = createSignal(false)
  const [llmKeyConfigured, setLlmKeyConfigured] = createSignal(false)
  const [embeddingKeyConfigured, setEmbeddingKeyConfigured] = createSignal(false)

  const [errors, setErrors] = createSignal<MemoryFormErrors | null>(null)

  function applyProbe(p: MemoryProbeResult) {
    const form = buildInitialForm(p)
    setEnabled(form.enabled)
    setLlmEndpoint(form.llmEndpoint)
    setLlmModel(form.llmModel)
    setLlmKey("")
    setEmbeddingEndpoint(form.embeddingEndpoint)
    setEmbeddingModel(form.embeddingModel)
    setEmbeddingKey("")
    setReuseEmbedding(form.reuseEmbedding)
    setLlmKeyConfigured(form.llmKeyConfigured)
    setEmbeddingKeyConfigured(form.embeddingKeyConfigured)
  }

  onMount(async () => {
    try {
      const raw = await window.api.onboardingProbe("memory")
      const p = normalizeMemoryProbe(raw)
      if (p.error) {
        setProbeError(p.error)
        props.onStatusChange?.("error")
        props.onError(p.error)
        return
      }
      applyProbe(p)
    } catch (error) {
      const message = error instanceof Error ? error.message : t.probeFailed
      setProbeError(message)
      props.onStatusChange?.("error")
      props.onError(message)
    } finally {
      setProbing(false)
    }
  })

  function getFormState(): MemoryFormState {
    return {
      enabled: enabled(),
      llmEndpoint: llmEndpoint(),
      llmModel: llmModel(),
      llmKey: llmKey(),
      embeddingEndpoint: embeddingEndpoint(),
      embeddingModel: embeddingModel(),
      embeddingKey: embeddingKey(),
      reuseEmbedding: reuseEmbedding(),
      llmKeyConfigured: llmKeyConfigured(),
      embeddingKeyConfigured: embeddingKeyConfigured(),
    }
  }

  async function handleSave(e: Event) {
    e.preventDefault()
    props.onError(null)

    const form = getFormState()
    const validationErrors = validateMemoryForm(form)
    if (validationErrors) {
      setErrors(validationErrors)
      return
    }
    setErrors(null)

    props.onStatusChange?.("working")
    setSubmitting(true)

    try {
      const payload = buildMemoryPayload(form)
      const res = await window.api.onboardingExecuteStep("memory-config", payload)

      if (res.status === "completed" || res.status === "reused") {
        const raw = await window.api.onboardingProbe("memory")
        const p = normalizeMemoryProbe(raw)
        if (!isMemoryProbeSatisfied(p, form.enabled)) {
          props.onStatusChange?.("error")
          props.onError(p.error ?? t.verifyFailed)
          return
        }
        applyProbe(p)

        const summary = buildMemoryResultSummary(res.result ?? {})
        setResultSummary(summary)
        props.onStatusChange?.("success")
      } else {
        props.onStatusChange?.("error")
        props.onError(res.error?.message ?? "记忆配置保存失败。")
      }
    } catch (err) {
      props.onStatusChange?.("error")
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  function outcomeLabel(outcome: string): string {
    if (outcome === "created") return t.resultOutcomeCreated
    if (outcome === "updated") return t.resultOutcomeUpdated
    return t.resultOutcomeReused
  }

  return (
    <form id="onboarding-step-memory-config" onSubmit={handleSave} class="ob-step-content">
      <Show when={probing()}>
        <ProgressDisplay phase={t.probing} />
      </Show>

      <Show when={!probing() && probeError()}>
        <div class="ob-memory-probe-error">{t.probeFailed}</div>
      </Show>

      <Show when={!probing() && !probeError() && !resultSummary()}>
        <div class="ob-form-group">
          <div class="ob-memory-toggle">
            <input
              type="checkbox"
              id="enable-memory"
              checked={enabled()}
              onChange={(e) => setEnabled(e.currentTarget.checked)}
              class="ob-memory-toggle-control"
            />
            <label
              for="enable-memory"
              class="ob-memory-toggle-label"
            >
              {t.enableLabel}
            </label>
          </div>
          <p class="ob-memory-description">
            {t.enableDescription}
          </p>
          <p class="ob-memory-scope">
            {t.globalScope}
          </p>
        </div>

        <Show when={!enabled()}>
          <div class="ob-memory-disabled">
            {t.disabledHint}
          </div>
        </Show>

        <Show when={enabled()}>
          <div class="ob-memory-section">
            <div class="ob-ontology-section-title">{t.llmSection}</div>
            <p class="ob-field-help">{t.llmSectionDesc}</p>
          </div>

          <div class="ob-form-group">
            <label class="ob-label" for="llm-endpoint">{t.llmEndpointLabel}</label>
            <input
              type="url"
              id="llm-endpoint"
              class="ob-input"
              placeholder={t.llmEndpointPlaceholder}
              value={llmEndpoint()}
              onInput={(e) => setLlmEndpoint(e.currentTarget.value)}
              disabled={submitting()}
            />
            <Show when={errors()?.llmEndpoint}>
              <p class="ob-field-error">{errors()!.llmEndpoint}</p>
            </Show>
          </div>

          <div class="ob-form-group">
            <label class="ob-label" for="llm-model">{t.llmModelLabel}</label>
            <input
              type="text"
              id="llm-model"
              class="ob-input"
              placeholder={t.llmModelPlaceholder}
              value={llmModel()}
              onInput={(e) => setLlmModel(e.currentTarget.value)}
              disabled={submitting()}
            />
            <Show when={errors()?.llmModel}>
              <p class="ob-field-error">{errors()!.llmModel}</p>
            </Show>
          </div>

          <div class="ob-form-group">
            <label class="ob-label" for="llm-key">{t.llmKeyLabel}</label>
            <input
              type="password"
              id="llm-key"
              class="ob-input"
              placeholder={llmKeyConfigured() ? t.llmKeySaved : t.llmKeyPlaceholder}
              value={llmKey()}
              onInput={(e) => setLlmKey(e.currentTarget.value)}
              autocomplete="off"
              disabled={submitting()}
            />
            <Show when={errors()?.llmKey}>
              <p class="ob-field-error">{errors()!.llmKey}</p>
            </Show>
          </div>

          <div class="ob-memory-section">
            <div class="ob-ontology-section-title">{t.embeddingSection}</div>
            <p class="ob-field-help">{t.embeddingSectionDesc}</p>
          </div>

          <div class="ob-form-group ob-memory-reuse">
            <input
              type="checkbox"
              id="reuse-embedding"
              checked={reuseEmbedding()}
              onChange={(e) => setReuseEmbedding(e.currentTarget.checked)}
              class="ob-memory-reuse-control"
              disabled={submitting()}
            />
            <label for="reuse-embedding" class="ob-memory-reuse-label">
              {t.reuseLabel}
            </label>
          </div>
          <p class="ob-field-help">{t.reuseDescription}</p>

          <Show when={!reuseEmbedding()}>
            <div class="ob-form-group">
              <label class="ob-label" for="emb-endpoint">{t.embeddingEndpointLabel}</label>
              <input
                type="url"
                id="emb-endpoint"
                class="ob-input"
                placeholder={t.embeddingEndpointPlaceholder}
                value={embeddingEndpoint()}
                onInput={(e) => setEmbeddingEndpoint(e.currentTarget.value)}
                disabled={submitting()}
              />
              <Show when={errors()?.embeddingEndpoint}>
                <p class="ob-field-error">{errors()!.embeddingEndpoint}</p>
              </Show>
            </div>

            <div class="ob-form-group">
              <label class="ob-label" for="emb-key">{t.embeddingKeyLabel}</label>
              <input
                type="password"
                id="emb-key"
                class="ob-input"
                placeholder={embeddingKeyConfigured() ? t.embeddingKeySaved : t.embeddingKeyPlaceholder}
                value={embeddingKey()}
                onInput={(e) => setEmbeddingKey(e.currentTarget.value)}
                autocomplete="off"
                disabled={submitting()}
              />
            </div>
          </Show>

          <div class="ob-form-group">
            <label class="ob-label" for="emb-model">{t.embeddingModelLabel}</label>
            <input
              type="text"
              id="emb-model"
              class="ob-input"
              placeholder={t.embeddingModelPlaceholder}
              value={embeddingModel()}
              onInput={(e) => setEmbeddingModel(e.currentTarget.value)}
              disabled={submitting()}
            />
            <Show when={errors()?.embeddingModel}>
              <p class="ob-field-error">{errors()!.embeddingModel}</p>
            </Show>
          </div>
        </Show>
      </Show>
    </form>
  )
}
