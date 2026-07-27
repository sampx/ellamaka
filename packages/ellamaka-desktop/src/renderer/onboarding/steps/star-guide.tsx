import { createSignal, Show } from "solid-js"

export interface StepProps {
  onStatusChange?: (status: "working" | "success" | "error") => void
  onComplete: () => void
  onError: (msg: string | null) => void
}

export function StarGuideStep(props: StepProps) {
  const [isSubmitting, setIsSubmitting] = createSignal<boolean>(false)

  const handleStar = async (event: Event) => {
    event.preventDefault()
    props.onError(null)
    props.onStatusChange?.("working")
    setIsSubmitting(true)
    try {
      const result = await window.api.onboardingExecuteStep("star-guide", { action: "star" })
      if (result.status === "completed" || result.status === "reused" || result.status === "skipped") {
        props.onStatusChange?.("success")
      } else {
        props.onStatusChange?.("error")
        props.onError(result.error?.message ?? "GitHub Star 操作失败。")
      }
    } catch (err) {
      props.onStatusChange?.("error")
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form id="onboarding-step-star-guide" onSubmit={handleStar} class="space-y-6" style={{ "text-align": "center", padding: "16px 0" }}>
      <div style={{ "font-size": "36px", "margin-bottom": "8px" }}>⭐</div>
      <h3 style={{ "font-size": "18px", "font-weight": "700", color: "#fff" }}>Support WopalSpace on GitHub</h3>
      <p style={{ "font-size": "14px", color: "var(--ob-text-muted)", "max-width": "420px", margin: "0 auto 24px" }}>
        Starring our open-source repository helps the team continue delivering next-generation AI coding tools.
      </p>

      <Show when={isSubmitting()}>
        <div class="ob-loading-state">正在处理 GitHub Star…</div>
      </Show>
    </form>
  )
}
