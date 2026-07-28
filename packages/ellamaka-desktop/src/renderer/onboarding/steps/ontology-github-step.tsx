import { createSignal, onMount, Show } from "solid-js"
import { ProgressDisplay } from "../components/ProgressDisplay"
import { normalizeOntologyResult, type OntologyResultSummary } from "./ontology-result"
import type { StepProps } from "./system-check"

type SourceType = "official" | "custom"

export function OntologyGithubStep(props: StepProps) {
  const [mode, setMode] = createSignal<"fork" | "clone">("clone")
  const [sourceType, setSourceType] = createSignal<SourceType>("official")
  const [customUrl, setCustomUrl] = createSignal("")
  const [githubToken, setGithubToken] = createSignal("")
  const [advancedOpen, setAdvancedOpen] = createSignal(false)
  const [hasGithubAuth, setHasGithubAuth] = createSignal(false)
  const [detectedTokenSource, setDetectedTokenSource] = createSignal<string | null>(null)
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
      if ((ghRes as any)?.source) {
        setDetectedTokenSource((ghRes as any).source)
      }
      const existingMode = (envRes as any)?.ontologyInstalled ? (envRes as any)?.ontologyMode : undefined
      setMode(existingMode === "fork" && authenticated ? "fork" : existingMode === "clone" ? "clone" : "clone")
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
      props.onError("请输入自定义能力模板库地址。")
      setIsSubmitting(false)
      return
    }

    try {
      // If user selected Fork and provided a token inline (or has authenticated token)
      if (mode() === "fork") {
        const tokenToSubmit = githubToken().trim()
        if (tokenToSubmit) {
          const authRes = await window.api.onboardingExecuteStep("github-auth", { token: tokenToSubmit })
          if (authRes.status === "failed") {
            props.onStatusChange?.("error")
            props.onError(authRes.error?.message ?? "GitHub Token 保存失败。")
            setIsSubmitting(false)
            return
          }
          setHasGithubAuth(true)
        } else if (!hasGithubAuth()) {
          props.onStatusChange?.("error")
          props.onError("创建个人远程副本需要先输入 GitHub Token。")
          setIsSubmitting(false)
          return
        }
      }

      // Execute ontology setup
      const res = await window.api.onboardingExecuteStep("ontology-setup", {
        mode: mode(),
        source,
      })

      if (res.status === "completed" || res.status === "reused") {
        setResultInfo(normalizeOntologyResult(res.result, mode(), sourceType()))
        props.onStatusChange?.("success")
      } else {
        props.onStatusChange?.("error")
        props.onError(res.error?.message ?? "能力模板库准备失败。")
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
        <ProgressDisplay phase="正在检查能力模板库配置…" />
      </Show>

      <Show when={!isProbing() && !resultInfo()}>
        <div class="ob-ontology-section">
          <div class="ob-ontology-section-title">选择能力模板库来源</div>
          <button
            type="button"
            class={`ob-source-option ${sourceType() === "official" ? "active" : ""}`}
            onClick={() => setSourceType("official")}
          >
            <span>
              <strong>标准官方能力模板库</strong>
              <small>提供最新预设好的角色、技能、规则和标准能力模板</small>
            </span>
            <span class="ob-plan-badge">推荐</span>
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
            <span>开发者自定义扩展（高级选项）</span>
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
                <span>自定义能力库地址</span>
              </label>
              <input
                type="url"
                class="ob-input"
                placeholder="粘贴 GitHub 仓库地址 (https://github.com/...)"
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
          <div class="ob-ontology-section-title">本地存储方式</div>
          <div class="ob-mode-options">
            <button
              type="button"
              class={`ob-mode-option ${mode() === "clone" ? "active" : ""}`}
              disabled={isSubmitting()}
              onClick={() => setMode("clone")}
            >
              <span class="ob-mode-option-title">
                <strong>仅下载到本机</strong>
                <span>默认快捷</span>
              </span>
              <small>无需 GitHub 登录，直接下载能力模板库到本机。推荐普通用户使用。</small>
            </button>

            <button
              type="button"
              class={`ob-mode-option ${mode() === "fork" ? "active" : ""}`}
              disabled={isSubmitting()}
              onClick={() => setMode("fork")}
            >
              <span class="ob-mode-option-title">
                <strong>创建个人远程副本 (推荐开发者)</strong>
              </span>
              <small>在 GitHub 创建你的专属副本，支持自定义扩展并回馈贡献社区。</small>
            </button>
          </div>
        </div>

        <Show when={mode() === "fork"}>
          <div class="ob-form-group" style={{ "margin-top": "16px", "padding": "12px", background: "rgba(255,255,255,0.03)", "border-radius": "8px" }}>
            <label class="ob-label">GitHub Token (创建远程副本所需)</label>
            <Show when={hasGithubAuth()} fallback={
              <div>
                <input
                  type="password"
                  class="ob-input"
                  placeholder="粘贴 GitHub Personal Access Token (repo 权限)"
                  value={githubToken()}
                  onInput={(e) => setGithubToken(e.currentTarget.value)}
                  disabled={isSubmitting()}
                />
                <span class="ob-field-help">Token 仅用于在 GitHub 为你创建能力库副本。</span>
              </div>
            }>
              <div style={{ "font-size": "13px", color: "var(--ob-accent)" }}>
                ✓ 已检测到有效的 GitHub 认证 ({detectedTokenSource() || "已连接"})
              </div>
            </Show>
          </div>
        </Show>

      </Show>

      <Show when={!isProbing() && resultInfo()}>
        <div class="ob-result-summary ob-ontology-result">
          <div class="ob-result-icon">✓</div>
          <div class="ob-result-title">能力模板库已准备就绪</div>
          <div class="ob-result-details">
            <div class="ob-result-row">
              <span class="ob-result-label">来源</span>
              <span class="ob-result-value">{resultInfo()?.sourceType === "official" ? "标准官方能力模板库" : "自定义能力库"}</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">方式</span>
              <span class="ob-result-value">{resultInfo()?.mode === "fork" ? "个人远程副本 (Fork)" : "本机下载 (Clone)"}</span>
            </div>
            <Show when={resultInfo()?.localPath}>
              <div class="ob-result-row">
                <span class="ob-result-label">存储位置</span>
                <span class="ob-result-value ob-result-mono">{resultInfo()?.localPath}</span>
              </div>
            </Show>
            <Show when={resultInfo()?.availableTypes.length}>
              <div class="ob-result-row">
                <span class="ob-result-label">可用类型</span>
                <span class="ob-result-value ob-result-accent">{resultInfo()?.availableTypes.length} 种</span>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </form>
  )
}
