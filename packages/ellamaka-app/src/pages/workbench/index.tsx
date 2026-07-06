import { createSignal, Show } from "solid-js"

export default function Workbench() {
  const [view, setView] = createSignal<"tui" | "chat" | "split">("tui")

  return (
    <div class="flex flex-col h-dvh bg-background-base">
      {/* Top bar */}
      <div class="h-10 bg-surface-base border-b border-border-base flex items-center px-4 gap-4">
        <div class="text-text-strong font-semibold">Ellamaka Workbench</div>
        <div class="flex gap-1 bg-surface-raised-base rounded-md p-0.5">
          <button
            class={`px-3 py-1 rounded text-sm transition-colors ${
              view() === "tui" ? "bg-background-base text-text-strong" : "text-text-weak hover:text-text-strong"
            }`}
            onClick={() => setView("tui")}
          >
            TUI
          </button>
          <button
            class={`px-3 py-1 rounded text-sm transition-colors ${
              view() === "chat" ? "bg-background-base text-text-strong" : "text-text-weak hover:text-text-strong"
            }`}
            onClick={() => setView("chat")}
          >
            Chat
          </button>
          <button
            class={`px-3 py-1 rounded text-sm transition-colors ${
              view() === "split" ? "bg-background-base text-text-strong" : "text-text-weak hover:text-text-strong"
            }`}
            onClick={() => setView("split")}
          >
            Split
          </button>
        </div>
      </div>

      {/* Main content */}
      <div class="flex-1 flex overflow-hidden">
        <Show when={view() === "tui" || view() === "split"}>
          <div class="flex-1 flex flex-col border-r border-border-base">
            <div class="flex-1 bg-surface-raised-base flex items-center justify-center">
              <div class="text-center">
                <div class="text-6xl mb-4">🖥️</div>
                <div class="text-text-strong text-xl mb-2">TUI View</div>
                <div class="text-text-weak text-sm">Terminal integration coming soon</div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={view() === "chat" || view() === "split"}>
          <div class="flex-1 flex flex-col">
            <div class="flex-1 bg-surface-raised-base flex items-center justify-center">
              <div class="text-center">
                <div class="text-6xl mb-4">💬</div>
                <div class="text-text-strong text-xl mb-2">Chat View</div>
                <div class="text-text-weak text-sm">Chat interface coming soon</div>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
