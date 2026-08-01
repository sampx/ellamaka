import { createSignal, For, onMount, Show } from "solid-js"
import { ProgressDisplay } from "../components/ProgressDisplay"
import { ResultPanel } from "../components/ResultPanel"
import { ONTOLOGY_MODES, ONTOLOGY_SOURCES } from "./ontology-options"
import { normalizeOntologyResult, type OntologyResultSummary } from "./ontology-result"
import {
  buildOntologyInitialState,
  executeOntologySetup,
  normalizeGithubAuthProbe,
  normalizeOntologyProbe,
  type GithubAuthProbe,
  type GithubCredentialSource,
  type OntologyMode,
  type OntologyProbe,
} from "./ontology-setup-flow"

export interface StepProps {
  onStatusChange?: (status: "idle" | "working" | "success" | "error") => void
  onComplete: () => void
  onError: (error: { code?: string; message: string; details?: string } | string | null) => void
}

type SourceType = "official" | "custom"

const SOURCE_LABELS: Record<GithubCredentialSource, string> = {
  "github-token-env": "环境变量 GITHUB_TOKEN",
  "gh-token-env": "环境变量 GH_TOKEN",
  "github-token-shell": "Shell 中的 GITHUB_TOKEN",
  "gh-token-shell": "Shell 中的 GH_TOKEN",
  "gh-cli": "GitHub CLI",
  "wopal-github-token": "WOPAL_HOME/.env · GITHUB_TOKEN",
  "wopal-gh-token": "WOPAL_HOME/.env · GH_TOKEN",
}

function credentialSourceLabel(source: GithubCredentialSource | null): string {
  return source ? SOURCE_LABELS[source] : "未检测到"
}

function OntologyTypes(props: { items: Array<{ type: string; branch: string }> }) {
  return (
    <div class="ob-space-types">
      <div class="ob-space-types-header">
        <span>可用空间类型</span>
        <span>{props.items.length} 种</span>
      </div>
      <Show when={props.items.length > 0} fallback={<div class="ob-space-types-empty">暂未检测到可用类型</div>}>
        <div class="ob-space-types-grid">
          <For each={props.items}>
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
  )
}

export function OntologySetupStep(props: StepProps) {
  const [mode, setMode] = createSignal<OntologyMode>("fork")
  const [sourceType, setSourceType] = createSignal<SourceType>("official")
  const [customUrl, setCustomUrl] = createSignal("")
  const [githubToken, setGithubToken] = createSignal("")
  const [githubError, setGithubError] = createSignal<string | null>(null)
  const [sourceError, setSourceError] = createSignal<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = createSignal(false)
  const [githubAuth, setGithubAuth] = createSignal<GithubAuthProbe>({
    detected: false,
    source: null,
    account: null,
    ghCliInstalled: false,
    ghCliAuthenticated: false,
    tokenConfigured: false,
    tokenSource: null,
  })
  const [ontologyProbe, setOntologyProbe] = createSignal<OntologyProbe | null>(null)
  const [isProbing, setIsProbing] = createSignal(true)
  const [probePhase, setProbePhase] = createSignal("正在检测 GitHub 配置…")
  const [isRecheckingGithub, setIsRecheckingGithub] = createSignal(false)
  const [isEditingGithub, setIsEditingGithub] = createSignal(false)
  const [isSavingGithub, setIsSavingGithub] = createSignal(false)
  const [isSubmitting, setIsSubmitting] = createSignal(false)
  const [resultInfo, setResultInfo] = createSignal<OntologyResultSummary | null>(null)

  const applyGithubProbe = async () => {
    const raw = await window.api.onboardingProbe("github-auth")
    const auth = normalizeGithubAuthProbe(raw)
    setGithubAuth(auth)
    if (auth.detected) setGithubError(null)
    return auth
  }

  onMount(async () => {
    props.onError(null)
    props.onStatusChange?.("working")
    try {
      setProbePhase("正在检测 GitHub 配置…")
      const authRaw = await window.api.onboardingProbe("github-auth")
      const auth = normalizeGithubAuthProbe(authRaw)
      setGithubAuth(auth)
      setProbePhase("正在检查空间能力本体…")
      const ontologyRaw = await window.api.onboardingProbe("ontology-setup")
      const ontology = normalizeOntologyProbe(ontologyRaw)
      const initial = buildOntologyInitialState(auth, ontology)
      setOntologyProbe(ontology)
      setMode(initial.mode)
      if (ontology.status === "ready") {
        // Auto-confirm reuse: execute backend to mark step done, then user can proceed directly
        try {
          const res = await executeOntologySetup(
            {
              mode: ontology.mode === "fork" ? "fork" : "clone",
              hasGithubAuth: auth.detected,
              githubToken: "",
              reuseExisting: true,
            },
            window.api.onboardingExecuteStep,
          )
          if (res.status === "completed" || res.status === "reused") {
            setResultInfo(normalizeOntologyResult(res.result, ontology.mode === "fork" ? "fork" : "clone", "official"))
            props.onStatusChange?.("success")
          } else {
            // Backend reuse failed — fall back to idle, user can manually retry
            props.onStatusChange?.("idle")
          }
        } catch {
          props.onStatusChange?.("idle")
        }
      } else if (ontology.status === "broken") {
        props.onStatusChange?.("error")
      } else {
        props.onStatusChange?.("idle")
      }
    } catch (error) {
      props.onStatusChange?.("error")
      props.onError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsProbing(false)
    }
  })

  const recheckGithub = async () => {
    setIsRecheckingGithub(true)
    try {
      const auth = await applyGithubProbe()
      if (!auth.detected) {
        setGithubError("仍未检测到认证；可粘贴 Token，或完成 gh auth login 后重试。")
      }
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsRecheckingGithub(false)
    }
  }

  const restoreStepStatus = () => {
    props.onStatusChange?.(ontologyProbe()?.status === "broken" ? "error" : "idle")
  }

  const saveGithubConfiguration = async () => {
    const token = githubToken().trim()
    if (!token) {
      setGithubError("请输入新的 GitHub Token。")
      return
    }

    setGithubError(null)
    setIsSavingGithub(true)
    props.onStatusChange?.("working")
    try {
      const response = await window.api.onboardingExecuteStep("github-auth", { token })
      if (response.status === "completed" || response.status === "reused") {
        setGithubToken("")
        setIsEditingGithub(false)
        await applyGithubProbe()
        restoreStepStatus()
      } else {
        setGithubError(response.error?.message ?? "GitHub 配置保存失败。")
        restoreStepStatus()
      }
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : String(error))
      restoreStepStatus()
    } finally {
      setIsSavingGithub(false)
    }
  }

  const handleSubmit = async (event: Event) => {
    event.preventDefault()
    props.onError(null)
    setGithubError(null)
    setSourceError(null)

    const currentOntology = ontologyProbe()
    if (currentOntology?.status === "broken") {
      props.onStatusChange?.("error")
      props.onError(currentOntology.error ?? "现有能力本体无法安全复用。")
      return
    }

    const source = sourceType() === "custom" ? customUrl().trim() : undefined
    if (sourceType() === "custom" && !source) {
      setSourceError("请输入 Git 仓库地址。")
      props.onStatusChange?.("idle")
      return
    }
    const reuseExisting = currentOntology?.status === "ready"
    if (mode() === "fork" && !githubAuth().detected && !githubToken().trim() && !reuseExisting) {
      setGithubError("请输入 GitHub Token，或完成 gh auth login 后重新检测。")
      props.onStatusChange?.("idle")
      return
    }

    props.onStatusChange?.("working")
    setIsSubmitting(true)
    try {
      const response = await executeOntologySetup(
        {
          mode: mode(),
          source,
          hasGithubAuth: githubAuth().detected,
          githubToken: githubToken(),
          reuseExisting,
        },
        window.api.onboardingExecuteStep,
      )
      if (response.status === "completed" || response.status === "reused") {
        setResultInfo(normalizeOntologyResult(response.result, mode(), sourceType()))
        if (githubToken().trim()) {
          setGithubToken("")
          setIsEditingGithub(false)
          await applyGithubProbe()
        }
        props.onStatusChange?.("success")
      } else {
        props.onStatusChange?.("error")
        props.onError({
          code: response.error?.code,
          message: response.error?.message ?? "空间能力本体准备失败。",
          details: response.error?.details,
        })
      }
    } catch (error) {
      props.onStatusChange?.("error")
      props.onError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form id="onboarding-step-ontology-setup" class="ob-step-content ob-ontology-flow" onSubmit={handleSubmit}>
      <Show when={isProbing()}>
        <ProgressDisplay phase={probePhase()} />
      </Show>

      <Show when={!isProbing()}>
        <div class={`ob-github-card ${githubAuth().detected ? "ready" : "required"}`}>
          <div class="ob-github-card-header">
            <span class="ob-github-card-icon">{githubAuth().detected ? "✓" : "GH"}</span>
            <div>
              <div class="ob-github-card-title">{githubAuth().detected ? "GitHub 已连接" : "GitHub 未连接"}</div>
              <div class="ob-github-card-description">
                {githubAuth().detected
                  ? "已完成环境检测，可使用现有凭据或重新配置。"
                  : "可配置 Token 使用 Fork；选择 Clone 时不强制连接。"}
              </div>
            </div>
          </div>

          <div class="ob-github-details">
            <div class="ob-github-detail-row">
              <span>账号</span>
              <strong>{githubAuth().account ? `@${githubAuth().account}` : "未获取"}</strong>
            </div>
            <div class="ob-github-detail-row">
              <span>GitHub CLI</span>
              <strong>{githubAuth().ghCliAuthenticated ? "已认证" : githubAuth().ghCliInstalled ? "已安装，未登录" : "未安装"}</strong>
            </div>
            <div class="ob-github-detail-row">
              <span>Token</span>
              <strong>{githubAuth().tokenConfigured ? credentialSourceLabel(githubAuth().tokenSource) : "未配置"}</strong>
            </div>
            <div class="ob-github-detail-row">
              <span>当前凭据</span>
              <strong>{credentialSourceLabel(githubAuth().source)}</strong>
            </div>
          </div>

          <Show when={!githubAuth().detected || isEditingGithub()}>
            <div class="ob-github-token-field">
              <label class="ob-label" for="ontology-github-token">{githubAuth().detected ? "新的 GitHub Token" : "GitHub Token"}</label>
              <input
                id="ontology-github-token"
                type="password"
                class="ob-input"
                placeholder="粘贴具有 Fork 权限的 Token"
                value={githubToken()}
                autocomplete="off"
                disabled={isSubmitting() || isSavingGithub()}
                onInput={(event) => {
                  setGithubToken(event.currentTarget.value)
                  setGithubError(null)
                }}
              />
              <p class="ob-field-help">Token 仅写入当前设备的 WopalSpace 本地配置，不会在界面中回显。</p>
              <Show when={githubError()}><p class="ob-field-error">{githubError()}</p></Show>
              <div class="ob-github-config-actions">
                <Show when={githubAuth().detected}>
                  <button
                    type="button"
                    class="ob-button ob-button-secondary"
                    disabled={isSavingGithub()}
                    onClick={() => {
                      setGithubToken("")
                      setGithubError(null)
                      setIsEditingGithub(false)
                    }}
                  >
                    取消
                  </button>
                </Show>
                <button
                  type="button"
                  class="ob-button"
                  disabled={isSavingGithub() || !githubToken().trim()}
                  onClick={() => void saveGithubConfiguration()}
                >
                  {isSavingGithub() ? "正在保存…" : "保存 GitHub 配置"}
                </button>
              </div>
            </div>
          </Show>

          <div class="ob-github-actions">
            <button
              type="button"
              class="ob-inline-action"
              disabled={isSubmitting() || isSavingGithub() || isRecheckingGithub()}
              onClick={() => void recheckGithub()}
            >
              {isRecheckingGithub() ? "正在检测…" : "重新检测"}
            </button>
            <Show when={githubAuth().detected && !isEditingGithub()}>
              <button
                type="button"
                class="ob-inline-action"
                disabled={isSubmitting() || isSavingGithub()}
                onClick={() => setIsEditingGithub(true)}
              >
                重新配置
              </button>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={!isProbing() && ontologyProbe()?.status === "broken"}>
        <ResultPanel
          variant="error"
          title="无法复用现有能力本体"
          message={ontologyProbe()?.error ?? "检测到不完整的能力本体目录。"}
        >
          <div class="ob-result-details">
            <div class="ob-result-row">
              <span class="ob-result-label">目录</span>
              <span class="ob-result-value ob-result-location">{ontologyProbe()?.path}</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">处理原则</span>
              <span class="ob-result-value">不会自动删除或覆盖</span>
            </div>
          </div>
        </ResultPanel>
      </Show>

      <Show when={!isProbing() && ontologyProbe()?.status === "ready" && !resultInfo()}>
        <ResultPanel
          title="已检测到空间能力本体"
          message={ontologyProbe()?.mode === "fork" ? "将复用现有 Fork 配置。" : "将复用现有 Clone，不自动迁移或改写本地分支。"}
        >
          <div class="ob-result-details">
            <div class="ob-result-row">
              <span class="ob-result-label">同步方式</span>
              <span class="ob-result-value">{ontologyProbe()?.mode === "fork" ? "Fork · 可同步" : "Clone · 仅本机"}</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">本地位置</span>
              <span class="ob-result-value ob-result-location">{ontologyProbe()?.path}</span>
            </div>
          </div>
          <OntologyTypes items={ontologyProbe()?.availableTypes ?? []} />
        </ResultPanel>
      </Show>

      <Show when={!isProbing() && ontologyProbe()?.status === "missing" && !resultInfo()}>
        <div class="ob-ontology-section">
          <div class="ob-ontology-section-title">能力来源</div>
          <button
            type="button"
            class={`ob-source-option ${sourceType() === "official" ? "active" : ""}`}
            disabled={isSubmitting()}
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
            disabled={isSubmitting()}
            onClick={() => {
              const next = !advancedOpen()
              setAdvancedOpen(next)
              if (!next) setSourceType("official")
            }}
          >
            <span>使用其他 Git 仓库</span>
            <span>{advancedOpen() ? "收起" : "高级"}</span>
          </button>

          <Show when={advancedOpen()}>
            <div class="ob-custom-source">
              <label class="ob-label" for="ontology-source-url">Git 仓库地址</label>
              <input
                id="ontology-source-url"
                type="url"
                class="ob-input"
                placeholder="https://github.com/example/ontology.git"
                value={customUrl()}
                disabled={isSubmitting()}
                onFocus={() => setSourceType("custom")}
                onInput={(event) => {
                  setSourceType("custom")
                  setCustomUrl(event.currentTarget.value)
                  setSourceError(null)
                }}
              />
              <Show when={sourceError()}><p class="ob-field-error">{sourceError()}</p></Show>
            </div>
          </Show>
        </div>

        <div class="ob-ontology-section">
          <div class="ob-ontology-section-title">同步方式</div>
          <div class="ob-mode-options">
            <For each={ONTOLOGY_MODES}>
              {(option) => (
                <button
                  type="button"
                  class={`ob-mode-option ${mode() === option.id ? "active" : ""}`}
                  disabled={isSubmitting()}
                  onClick={() => {
                    setMode(option.id)
                    if (option.id === "clone") setGithubError(null)
                  }}
                >
                  <span class="ob-mode-option-title">
                    <strong>{option.name}</strong>
                    <Show when={option.recommended}><span>推荐</span></Show>
                  </span>
                  <small>{option.summary}</small>
                </button>
              )}
            </For>
          </div>
        </div>

      </Show>

      <Show when={resultInfo()}>
        <ResultPanel
          title="空间能力本体已就绪"
          message={resultInfo()?.mode === "fork" ? "个人远程副本已准备完成。" : "本体已下载到当前电脑。"}
        >
          <div class="ob-result-details">
            <div class="ob-result-row">
              <span class="ob-result-label">能力来源</span>
              <span class="ob-result-value">{resultInfo()?.sourceType === "official" ? "WopalSpace 官方本体" : "其他 Git 仓库"}</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">同步方式</span>
              <span class="ob-result-value">{resultInfo()?.mode === "fork" ? "Fork · 可同步" : "Clone · 仅本机"}</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">本地位置</span>
              <span class="ob-result-value ob-result-location">{resultInfo()?.localPath}</span>
            </div>
          </div>
          <OntologyTypes items={resultInfo()?.availableTypes ?? []} />
        </ResultPanel>
      </Show>
    </form>
  )
}
