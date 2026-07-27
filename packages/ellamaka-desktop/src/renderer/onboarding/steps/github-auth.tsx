import { createSignal, onMount, Show } from "solid-js"
import { ProgressDisplay } from "../components/ProgressDisplay"

export interface StepProps {
  onStatusChange?: (status: "working" | "success" | "error") => void
  onComplete: () => void
  onError: (msg: string | null) => void
}

export function GithubAuthStep(props: StepProps) {
  const [pat, setPat] = createSignal<string>("")
  const [isSubmitting, setIsSubmitting] = createSignal<boolean>(false)
  const [isProbing, setIsProbing] = createSignal<boolean>(true)
  const [isConfigured, setIsConfigured] = createSignal<boolean>(false)
  const [detectedToken, setDetectedToken] = createSignal<string | null>(null)
  const [tokenSource, setTokenSource] = createSignal<string | null>(null)
  const [useCustomToken, setUseCustomToken] = createSignal<boolean>(false)

  const sourceLabel = () => {
    const source = tokenSource() ?? ""
    if (source === "GITHUB_TOKEN (environment)") return "环境变量 GITHUB_TOKEN"
    if (source === "GH_TOKEN (environment)") return "环境变量 GH_TOKEN"
    if (source === "GITHUB_TOKEN (user shell profile)") return "Shell 配置中的 GITHUB_TOKEN"
    if (source === "GH_TOKEN (user shell profile)") return "Shell 配置中的 GH_TOKEN"
    if (source === "gh CLI toolchain (authenticated)") return "GitHub CLI（已认证）"
    if (source === "WOPAL_HOME/.env") return "WOPAL_HOME/.env"
    return "已检测凭据"
  }

  onMount(async () => {
    try {
      const res = await Promise.race<any>([
        window.api.onboardingProbe("github-auth"),
        new Promise((resolve) => setTimeout(() => resolve({ detected: false }), 10000)),
      ])
      if (res && (res as any).detected) {
        setDetectedToken((res as any).maskedToken || "ghp_****")
        setTokenSource((res as any).source || "System Shell Environment")
      } else {
        setUseCustomToken(true)
      }
    } catch {
      setUseCustomToken(true)
    } finally {
      setIsProbing(false)
    }
  })

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const token = useCustomToken() ? pat().trim() : undefined
    if (useCustomToken() && !token) {
      props.onStatusChange?.("error")
      props.onError("请输入 GitHub Token，或选择跳过此步骤。")
      return
    }
    props.onError(null)
    props.onStatusChange?.("working")
    setIsSubmitting(true)
    try {
      const res = await window.api.onboardingExecuteStep("github-auth", { token })
      if (res.status === "completed" || res.status === "reused") {
        setIsConfigured(true)
        props.onStatusChange?.("success")
      } else {
        props.onStatusChange?.("error")
        props.onError(res.error?.message ?? "GitHub 认证未完成。")
      }
    } catch (err) {
      props.onStatusChange?.("error")
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form id="onboarding-step-github-auth" onSubmit={handleSubmit} class="ob-step-content">
      <Show when={isProbing()}>
        <ProgressDisplay phase="正在检测 GitHub 认证…" />
      </Show>

      <Show when={!isProbing() && isConfigured()}>
        <div class="ob-result-summary">
          <div class="ob-result-icon">✓</div>
          <div class="ob-result-title">GitHub 认证已配置</div>
          <div class="ob-result-details">
            <div class="ob-result-row">
              <span class="ob-result-label">凭据来源</span>
              <span class="ob-result-value">{useCustomToken() ? "手动输入" : sourceLabel()}</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">状态</span>
              <span class="ob-result-value ob-result-accent">可以使用</span>
            </div>
          </div>
        </div>
      </Show>

      <Show when={!isProbing() && !isConfigured()}>
        <Show when={detectedToken() && !useCustomToken()}>
          <div class="ob-credential-card">
            <div class="ob-credential-heading">
              <span class="ob-credential-icon">✓</span>
              <div>
                <div class="ob-credential-title">已检测到 GitHub Token</div>
                <div class="ob-credential-description">确认后将验证此凭据，并保存到 WopalSpace。</div>
              </div>
            </div>
            <div class="ob-result-details">
              <div class="ob-result-row">
                <span class="ob-result-label">来源</span>
                <span class="ob-result-value">{sourceLabel()}</span>
              </div>
              <div class="ob-result-row">
                <span class="ob-result-label">Token</span>
                <span class="ob-result-value ob-result-mono">{detectedToken()}</span>
              </div>
            </div>
            <div class="ob-credential-actions">
              <button type="submit" class="ob-button" disabled={isSubmitting()}>
                {isSubmitting() ? "正在验证…" : "使用此 Token"}
              </button>
              <button type="button" class="ob-button ob-button-secondary" disabled={isSubmitting()} onClick={() => setUseCustomToken(true)}>
                使用其他 Token
              </button>
            </div>
          </div>
        </Show>

        <Show when={useCustomToken()}>
          <div class="ob-form-group">
            <label class="ob-label" for="github-token">GitHub 个人访问令牌（PAT）</label>
            <input
              id="github-token"
              type="password"
              class="ob-input"
              value={pat()}
              onInput={(e) => setPat(e.currentTarget.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              autocomplete="off"
              disabled={isSubmitting()}
            />
            <p class="ob-field-help">用于访问私有仓库元数据和 Gist。Token 将在本机安全配置。</p>
            <div class="ob-credential-actions">
              <button type="submit" class="ob-button" disabled={isSubmitting() || !pat().trim()}>
                {isSubmitting() ? "正在验证…" : "保存 Token"}
              </button>
              <Show when={detectedToken()}>
                <button type="button" class="ob-button ob-button-secondary" disabled={isSubmitting()} onClick={() => setUseCustomToken(false)}>
                  使用检测到的 Token
                </button>
              </Show>
            </div>
          </div>
        </Show>
      </Show>
    </form>
  )
}
