import { createSignal, onMount, Show, For } from "solid-js"
import { ProgressDisplay } from "../components/ProgressDisplay"

export interface StepProps {
  onStatusChange?: (status: "working" | "success" | "error") => void
  onComplete: () => void
  onSkip?: () => void
  onError: (error: {
    code?: string
    message: string
    details?: string
  } | string | null) => void
}

interface AvailableType {
  type: string
  branch: string
}

interface SpaceEntry {
  name: string
  path: string
  type?: string | null
}

interface SpaceResult {
  name: string
  path: string
  type: string
  status: "completed" | "reused"
  message?: string
}

export function CreateSpaceStep(props: StepProps) {
  const [spaceDir, setSpaceDir] = createSignal<string>("")
  const [spaceType, setSpaceType] = createSignal<string>("")
  const [availableTypes, setAvailableTypes] = createSignal<AvailableType[]>([])
  const [existingSpaces, setExistingSpaces] = createSignal<SpaceEntry[]>([])
  const [isSubmitting, setIsSubmitting] = createSignal<boolean>(false)
  const [isLoading, setIsLoading] = createSignal<boolean>(true)
  const [probeError, setProbeError] = createSignal<string | null>(null)
  const [resultInfo, setResultInfo] = createSignal<SpaceResult | null>(null)

  const loadEnvironment = async () => {
    props.onError(null)
    setProbeError(null)
    setIsLoading(true)
    try {
      const envData = await window.api.onboardingProbe("environment")
      const error = typeof envData.error === "string" ? envData.error : null
      if (error) throw new Error(error)

      const types = Array.isArray(envData.availableTypes)
        ? envData.availableTypes as AvailableType[]
        : []
      if (types.length === 0) {
        throw new Error("未检测到可用的空间类型，请返回上一步重新初始化。")
      }
      setAvailableTypes(types)
      if (!types.some((item) => item.type === spaceType())) {
        setSpaceType(types[0].type)
      }

      const spaces = Array.isArray(envData.spaces)
        ? envData.spaces as SpaceEntry[]
        : []
      setExistingSpaces(spaces)

      const defaultPath = typeof envData.defaultSpacePath === "string"
        ? envData.defaultSpacePath
        : ""
      if (defaultPath && !spaceDir()) {
        setSpaceDir(defaultPath)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setProbeError(message)
      props.onStatusChange?.("error")
      props.onError(message)
    } finally {
      setIsLoading(false)
    }
  }

  onMount(() => {
    void loadEnvironment()
  })

  const handleSkipCreate = async () => {
    props.onError(null)
    props.onStatusChange?.("working")
    setIsSubmitting(true)
    try {
      const res = await window.api.onboardingExecuteStep("create-space", { skip: true })
      if (res.status === "skipped" || res.status === "completed" || res.status === "reused") {
        props.onStatusChange?.("success")
        props.onComplete()
      } else {
        props.onStatusChange?.("error")
        props.onError(res.error?.message ?? "无法跳过工作空间创建。")
      }
    } catch (err) {
      props.onStatusChange?.("error")
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    if (!spaceDir().trim()) {
      props.onStatusChange?.("error")
      props.onError("请选择或输入工作空间目录。")
      return
    }
    if (!spaceType() || availableTypes().length === 0) {
      props.onStatusChange?.("error")
      props.onError("能力类型不可用，请返回上一步重新配置。")
      return
    }

    props.onError(null)
    props.onStatusChange?.("working")
    setIsSubmitting(true)

    try {
      const res = await window.api.onboardingExecuteStep("create-space", {
        path: spaceDir().trim(),
        type: spaceType(),
      })
      if (res.status === "completed" || res.status === "reused") {
        const result = res.result ?? {}
        setResultInfo({
          name: typeof result.spaceName === "string" ? result.spaceName : spaceDir().split("/").filter(Boolean).at(-1) ?? "Space",
          path: typeof result.spacePath === "string" ? result.spacePath : spaceDir().trim(),
          type: spaceType(),
          status: res.status,
          message: typeof result.message === "string" ? result.message : undefined,
        })
        props.onStatusChange?.("success")
      } else {
        props.onStatusChange?.("error")
        const message = res.error?.message ?? "工作空间创建失败。"
        const details = [
          res.error?.suggestion ? `建议: ${res.error.suggestion}` : "",
          res.error?.details ?? "",
        ].filter(Boolean).join("\n")
        props.onError({
          code: res.error?.code,
          message,
          details: details || undefined,
        })
      }
    } catch (err) {
      props.onStatusChange?.("error")
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBrowse = async () => {
    try {
      const result = await window.api.openDirectoryPicker({
        title: "选择工作空间根目录",
        defaultPath: spaceDir(),
      })
      if (typeof result === "string") {
        setSpaceDir(result)
      } else if (Array.isArray(result) && result[0]) {
        setSpaceDir(result[0])
      }
    } catch {
      // ignore dialog cancel
    }
  }

  const handleSelectExistingSpace = (space: SpaceEntry) => {
    setSpaceDir(space.path)
    if (space.type) {
      setSpaceType(space.type)
    }
  }

  return (
    <form id="onboarding-step-create-space" onSubmit={handleSubmit} class="space-y-6">
      <Show when={isLoading()}>
        <ProgressDisplay phase="正在检测已有工作空间与能力类型…" />
      </Show>

      <Show when={!isLoading() && probeError()}>
        <div class="ob-result-summary">
          <div class="ob-result-icon ob-result-error">✗</div>
          <div class="ob-result-title">工作空间环境检查未通过</div>
          <div class="ob-result-subtitle">{probeError()}</div>
          <div class="ob-credential-actions">
            <button type="button" class="ob-button" onClick={() => void loadEnvironment()}>
              重新检查
            </button>
          </div>
        </div>
      </Show>

      <Show when={resultInfo()}>
        <div class="ob-result-summary">
          <div class="ob-result-icon">✓</div>
          <div class="ob-result-title">
            {resultInfo()?.status === "reused" ? "已复用现有工作空间" : "工作空间已创建"}
          </div>
          <div class="ob-result-details">
            <div class="ob-result-row">
              <span class="ob-result-label">名称</span>
              <span class="ob-result-value">{resultInfo()?.name}</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">路径</span>
              <span class="ob-result-value ob-result-mono">{resultInfo()?.path}</span>
            </div>
            <div class="ob-result-row">
              <span class="ob-result-label">类型</span>
              <span class="ob-result-value">{resultInfo()?.type}</span>
            </div>
          </div>
        </div>
      </Show>

      <Show when={!isLoading() && !probeError() && !resultInfo()}>
        <Show when={existingSpaces().length > 0}>
          <div class="ob-existing-spaces-banner" style={{ "background": "rgba(255,255,255,0.04)", "border-radius": "8px", "padding": "16px", "margin-bottom": "20px" }}>
            <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "12px" }}>
              <div>
                <strong style={{ "font-size": "14px" }}>检测到已存在 {existingSpaces().length} 个工作空间</strong>
                <p style={{ "font-size": "12px", color: "var(--ob-text-subtle)", margin: "2px 0 0" }}>
                  您可以直接跳过创建并继续，或者在下面创建新的工作空间。
                </p>
              </div>
              <button
                type="button"
                class="ob-button ob-button-secondary"
                onClick={handleSkipCreate}
                disabled={isSubmitting()}
                style={{ padding: "8px 16px", "font-size": "13px" }}
              >
                跳过创建（复用已有）
              </button>
            </div>

            <div class="ob-form-group">
              <label class="ob-label" style={{ "font-size": "12px" }}>已有空间列表：</label>
              <For each={existingSpaces()}>
                {(space) => (
                  <button
                    type="button"
                    class="ob-button ob-button-secondary"
                    style={{ display: "block", width: "100%", "text-align": "left", "margin-bottom": "4px", padding: "8px 12px" }}
                    onClick={() => handleSelectExistingSpace(space)}
                  >
                    <span style={{ "font-weight": "600" }}>{space.name}</span>
                    <span style={{ "font-size": "11px", color: "var(--ob-text-subtle)", "margin-left": "8px" }}>{space.path}</span>
                    {space.type && <span style={{ "font-size": "11px", color: "var(--ob-accent)", "margin-left": "8px" }}>[{space.type}]</span>}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <div class="ob-form-group">
          <label class="ob-label">工作空间目录</label>
          <div class="ob-input-row" style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              class="ob-input"
              style={{ flex: 1 }}
              value={spaceDir()}
              onInput={(e) => setSpaceDir(e.currentTarget.value)}
              placeholder="~/WopalSpace"
              disabled={isSubmitting()}
            />
            <button
              type="button"
              class="ob-button ob-button-secondary"
              onClick={handleBrowse}
              disabled={isSubmitting()}
              style={{ padding: "0 14px", "white-space": "nowrap", "font-size": "13px" }}
            >
              选择目录
            </button>
          </div>
          <p style={{ "font-size": "12px", color: "var(--ob-text-subtle)", "margin-top": "6px" }}>
            该目录将承载项目文件与 <code>.wopal-space/</code> 空间配置。
          </p>
        </div>

        <div class="ob-form-group" style={{ "margin-top": "18px" }}>
          <label class="ob-label" for="space-type-select">
            空间类型
          </label>
          <select
            id="space-type-select"
            class="ob-input"
            value={spaceType()}
            onChange={(e) => setSpaceType(e.currentTarget.value)}
            disabled={isSubmitting() || isLoading()}
            style={{ "text-transform": "capitalize" }}
          >
            <Show when={isLoading()}>
              <option value="">正在加载类型…</option>
            </Show>
            <For each={availableTypes()}>
              {(t) => (
                <option value={t.type}>
                  {t.type === "common" ? "通用 (main 分支)" : `${t.type}`}
                </option>
              )}
            </For>
          </select>
        </div>

      </Show>
    </form>
  )
}
