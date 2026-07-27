import { createSignal, For, onMount, Show } from "solid-js"
import { ProgressDisplay } from "../components/ProgressDisplay"
import { ONTOLOGY_MODES, ONTOLOGY_SOURCES } from "./ontology-options"
import { normalizeOntologyResult, type OntologyResultSummary } from "./ontology-result"

export interface StepProps {
  onStatusChange?: (status: "working" | "success" | "error") => void
  onComplete: () => void
  onError: (msg: string | null) => void
}

type SourceType = "official" | "custom"

export function OntologySetupStep(props: StepProps) {
  const [mode, setMode] = createSignal<"fork" | "clone">("clone")
  const [sourceType, setSourceType] = createSignal<SourceType>("official")
  const [customUrl, setCustomUrl] = createSignal("")
  const [advancedOpen, setAdvancedOpen] = createSignal(false)
  const [hasGithubAuth, setHasGithubAuth] = createSignal(false)
  const [isProbing, setIsProbing] = createSignal(true)
  const [isSubmitting, setIsSubmitting] = createSignal(false)
  const [resultInfo, setResultInfo] = createSignal<OntologyResultSummary | null>(null)

  onMount(async () => {
    try {
      const [ghRes, envRes] = await Promise.all([
        window.api.onboardingProbe("github-auth"),
        window.api.onboardingProbe("environment"),
      ])
      const authenticated = Boolean((ghRes as any)?.detected)
      setHasGithubAuth(authenticated)
      const existingMode = (envRes as any)?.ontologyInstalled ? (envRes as any)?.ontologyMode : undefined
      setMode(existingMode === "fork" && authenticated ? "fork" : existingMode === "clone" ? "clone" : authenticated ? "fork" : "clone")
    } catch {
      setMode("clone")
    } finally {
      setIsProbing(false)
    }
  })

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    props.onError(null)
    props.onStatusChange?.("working")
    setIsSubmitting(true)

    const source = sourceType() === "custom" ? customUrl().trim() : undefined
    if (sourceType() === "custom" && !source) {
      props.onStatusChange?.("error")
      props.onError("请输入定制能力本体地址。")
      setIsSubmitting(false)
      return
    }
    if (mode() === "fork" && !hasGithubAuth()) {
      props.onStatusChange?.("error")
      props.onError("Fork 模式需要先配置 GitHub Token。")
      setIsSubmitting(false)
      return
    }

    try {
      const res = await window.api.onboardingExecuteStep("ontology-setup", {
        mode: mode(),
        source,
      })
      if (res.status === "completed" || res.status === "reused") {
        setResultInfo(normalizeOntologyResult(res.result, mode(), sourceType()))
        props.onStatusChange?.("success")
      } else {
        props.onStatusChange?.("error")
        props.onError(res.error?.message ?? "空间能力本体准备失败。")
      }
    } catch (err) {
      props.onStatusChange?.("error")
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form id="onboarding-step-ontology-setup" class="ob-step-content" onSubmit={handleSubmit}>
      <Show when={isProbing()}>
        <ProgressDisplay phase="正在检查能力本体配置…" />
      </Show>

      <Show when={!isProbing() && !resultInfo()}>
        <div class="ob-ontology-section">
          <div class="ob-ontology-section-title">能力本体来源</div>
          <button
            type="button"
            class={`ob-source-option ${sourceType() === "official" ? "active" : ""}`}
            onClick={() => setSourceType("official")}
          >
            <span>
              <strong>{ONTOLOGY_SOURCES[0].name}</strong>
              <small>{ONTOLOGY_SOURCES[0].description}</small>
            </span>
            <span class="ob-plan-badge">默认</span>
          </button>

          <button
            type="button"
            class="ob-advanced-toggle"
            aria-expanded={advancedOpen()}
            onClick={() => {
              const next = !advancedOpen()
              setAdvancedOpen(next)
              if (!next) setSourceType("official")
            }}
          >
            <span>使用定制能力本体（高级）</span>
            <span>{advancedOpen() ? "收起" : "展开"}</span>
          </button>

          <Show when={advancedOpen()}>
            <div class="ob-custom-source">
              <label class="ob-radio-row">
                <input
                  type="radio"
                  name="ontology-source"
                  checked={sourceType() === "custom"}
                  onChange={() => setSourceType("custom")}
                />
                <span>{ONTOLOGY_SOURCES[1].description}</span>
              </label>
              <input
                type="url"
                class="ob-input"
                placeholder="粘贴能力本体地址"
                value={customUrl()}
                onFocus={() => setSourceType("custom")}
                onInput={(event) => {
                  setSourceType("custom")
                  setCustomUrl(event.currentTarget.value)
                }}
                disabled={isSubmitting()}
              />
            </div>
          </Show>
        </div>

        <div class="ob-ontology-section">
          <div class="ob-ontology-section-title">准备方式</div>
          <div class="ob-mode-options">
            {ONTOLOGY_MODES.map((option) => {
              const disabled = option.requiresGithubAuth && !hasGithubAuth()
              return (
                <button
                  type="button"
                  class={`ob-mode-option ${mode() === option.id ? "active" : ""}`}
                  disabled={disabled || isSubmitting()}
                  onClick={() => setMode(option.id)}
                >
                  <span class="ob-mode-option-title">
                    <strong>{option.name}</strong>
                    <Show when={option.recommended}><span>强烈推荐</span></Show>
                  </span>
                  <small>{option.summary}</small>
                  <Show when={disabled}><em>需要先配置 GitHub Token</em></Show>
                </button>
              )
            })}
          </div>
        </div>

        <div class="ob-credential-actions">
          <button
            type="submit"
            class="ob-button"
            disabled={isSubmitting() || (sourceType() === "custom" && !customUrl().trim())}
          >
            {isSubmitting() ? "正在准备…" : "准备此能力本体"}
          </button>
        </div>
      </Show>

      <Show when={resultInfo()}>
        <div class="ob-result-summary ob-ontology-result">
          <div class="ob-result-icon">✓</div>
          <div class="ob-result-title">空间能力本体已准备好</div>
          <div class="ob-result-details">
            <div class="ob-result-row">
              <span class="ob-result-label">来源</span>
              <span class="ob-result-value">{resultInfo()?.sourceType === "official" ? "WopalSpace 官方能力本体" : "定制能力本体"}</span>
            </div>
            <Show when={resultInfo()?.mode === "fork"} fallback={
              <div class="ob-result-row">
                <span class="ob-result-label">远程能力来源</span>
                <span class="ob-result-value ob-result-location">{resultInfo()?.remoteUrl}</span>
              </div>
            }>
              <div class="ob-result-row">
                <span class="ob-result-label">个人远程副本</span>
                <span class="ob-result-value ob-result-location">{resultInfo()?.remoteUrl}</span>
              </div>
              <div class="ob-result-row">
                <span class="ob-result-label">原始能力来源</span>
                <span class="ob-result-value ob-result-location">{resultInfo()?.upstreamUrl}</span>
              </div>
            </Show>
            <div class="ob-result-row">
              <span class="ob-result-label">本地保存位置</span>
              <span class="ob-result-value ob-result-location">{resultInfo()?.localPath}</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">准备方式</span>
              <span class="ob-result-value">{resultInfo()?.mode === "fork" ? "Fork · 可贡献" : "Clone · 仅本机"}</span>
            </div>
          </div>

          <div class="ob-space-types">
            <div class="ob-space-types-header">
              <span>可创建的 Space 类型</span>
              <span>{resultInfo()?.availableTypes.length ?? 0} 种</span>
            </div>
            <Show
              when={(resultInfo()?.availableTypes.length ?? 0) > 0}
              fallback={<div class="ob-space-types-empty">暂未检测到可用类型</div>}
            >
              <div class="ob-space-types-grid">
                <For each={resultInfo()?.availableTypes ?? []}>
                  {(item) => (
                    <div class="ob-space-type-item">
                      <strong>{item.type}</strong>
                      <code>{item.branch}</code>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </form>
  )
}
