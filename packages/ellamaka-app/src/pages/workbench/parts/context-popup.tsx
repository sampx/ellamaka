import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Popover } from "@opencode-ai/ui/popover"
import { Button } from "@opencode-ai/ui/button"
import { createMemo, createSignal, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"

export function ContextPopup(props: { sessionId?: string; directory?: string }) {
  const sync = useSync()
  const language = useLanguage()
  const providers = useProviders()
  const [open, setOpen] = createSignal(false)

  const messages = createMemo(() => {
    if (!props.sessionId) return []
    return sync.data.message[props.sessionId] ?? []
  })

  const metrics = createMemo(() =>
    getSessionContextMetrics(messages(), [...providers.all().values()]),
  )

  const context = createMemo(() => metrics().context)
  const cost = createMemo(() => metrics().totalCost)

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const usage = createMemo(() => context()?.usage ?? 0)

  const ringColor = createMemo(() => {
    const u = usage()
    if (u >= 100) return "[&_[data-slot=progress-circle-progress]]:stroke-red-500"
    if (u >= 80) return "[&_[data-slot=progress-circle-progress]]:stroke-amber-400"
    return ""
  })

  const barColor = createMemo(() => {
    const u = usage()
    if (u >= 100) return "bg-red-500"
    if (u >= 80) return "bg-amber-400"
    return "bg-v2-icon-icon-muted"
  })

  const barWidth = createMemo(() => `${Math.min(usage(), 100)}%`)

  return (
    <Show when={props.sessionId}>
      <Popover
        open={open()}
        onOpenChange={setOpen}
        placement="bottom-start"
        gutter={4}
        trigger={
          <button
            type="button"
            class="flex items-center justify-center cursor-pointer rounded hover:bg-v2-overlay-simple-overlay-hover p-0.5"
            aria-label="Context usage"
          >
            <ProgressCircle
              size={16}
              strokeWidth={2}
              percentage={usage()}
              class={ringColor()}
            />
          </button>
        }
        class="w-72"
      >
        <Show
          when={context()}
          fallback={
            <div class="p-3 text-12-regular text-v2-text-text-muted">
              No context data
            </div>
          }
        >
          {(ctx) => (
            <div class="flex flex-col gap-3 p-3">
              <div class="flex items-center justify-between">
                <span class="text-12-medium text-v2-text-text-base">
                  Context Usage
                </span>
                <span class="text-11-regular text-v2-text-text-muted">
                  {ctx().modelLabel}
                </span>
              </div>

              <div class="flex flex-col gap-1">
                <div class="flex items-center justify-between">
                  <span class="text-11-regular text-v2-text-text-muted">
                    Tokens
                  </span>
                  <span class="text-11-medium text-v2-text-text-base">
                    {ctx().total.toLocaleString(language.intl())}
                    <Show when={ctx().limit}>
                      {" / "}
                      {ctx().limit!.toLocaleString(language.intl())}
                    </Show>
                  </span>
                </div>
                <div class="h-1.5 rounded-full bg-v2-background-bg-deep overflow-hidden">
                  <div
                    class={barColor()}
                    classList={{
                      "h-full rounded-full transition-all": true,
                    }}
                    style={{ width: barWidth() }}
                  />
                </div>
              </div>

              <div class="flex flex-col gap-0.5 text-11-regular">
                <MetricRow
                  label="Input"
                  value={ctx().input.toLocaleString(language.intl())}
                />
                <MetricRow
                  label="Output"
                  value={ctx().output.toLocaleString(language.intl())}
                />
                <MetricRow
                  label="Reasoning"
                  value={ctx().reasoning.toLocaleString(language.intl())}
                />
                <MetricRow
                  label="Cache Read"
                  value={ctx().cacheRead.toLocaleString(language.intl())}
                />
                <MetricRow
                  label="Cache Write"
                  value={ctx().cacheWrite.toLocaleString(language.intl())}
                />
              </div>

              <div class="flex items-center justify-between border-t border-v2-border-border-base pt-2">
                <span class="text-11-regular text-v2-text-text-muted">
                  Cost
                </span>
                <span class="text-11-medium text-v2-text-text-base">
                  {usd().format(cost())}
                </span>
              </div>

              <div class="flex items-center gap-2 border-t border-v2-border-border-base pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  class="text-11-regular h-7"
                >
                  Compress
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  class="text-11-regular h-7"
                >
                  Clear
                </Button>
              </div>
            </div>
          )}
        </Show>
      </Popover>
    </Show>
  )
}

function MetricRow(props: { label: string; value: string }) {
  return (
    <div class="flex items-center justify-between">
      <span class="text-v2-text-text-muted">{props.label}</span>
      <span class="text-v2-text-text-base">{props.value}</span>
    </div>
  )
}
