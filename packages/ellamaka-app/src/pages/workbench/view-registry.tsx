import { type JSX, createSignal, createEffect, onCleanup, Show } from "solid-js"
import { MemoryRouter, createMemoryHistory, Route } from "@solidjs/router"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { Terminal } from "@/components/terminal"
import { SessionContextTab } from "@/components/session"
import { PanelChat } from "./parts/panel-chat"
import type { WorkbenchPanel } from "./view"
import type { Session } from "./session-store"

export type PanelViewCtx = {
  panel: WorkbenchPanel
  session?: Session
  directory: string
  sdk: any
  spaceName: string
  spacePath: string
}

export type PanelViewDef = {
  id: string
  label: string
  icon?: string
  requiresSession: boolean
  showContext: boolean
  availableInOpen: boolean
  render: (ctx: PanelViewCtx) => JSX.Element
}

export const viewRegistry: PanelViewDef[] = []

export function registerView(def: PanelViewDef): void {
  viewRegistry.push(def)
}

export function getView(id: string): PanelViewDef | undefined {
  return viewRegistry.find((v) => v.id === id)
}

export function listViews(): PanelViewDef[] {
  return viewRegistry
}

// ── TUI View ──────────────────────────────────────────────

registerView({
  id: "tui",
  label: "TUI",
  requiresSession: true,
  showContext: false,
  availableInOpen: false,
  render: (ctx) => {
    const [ptyId, setPtyId] = createSignal<string | undefined>(undefined)

    const startTui = () => {
      const args = ctx.session?.id
        ? ["attach", ctx.sdk.url || "http://localhost:3000", "-s", ctx.session.id]
        : undefined

      ctx.sdk.client.pty
        .create({
          command: "ellamaka",
          args,
          cwd: ctx.directory,
          title: `ellamaka tui (${ctx.panel.id})`,
        })
        .then((res: any) => {
          if (res.data?.id) setPtyId(res.data.id)
        })
        .catch(console.error)
    }

    // Auto-start TUI when view mounts
    createEffect(() => {
      if (ptyId()) return
      startTui()
    })

    onCleanup(() => {
      const id = ptyId()
      if (id) ctx.sdk.client.pty.remove({ ptyID: id }).catch(console.error)
    })

    return (
      <Show
        when={ptyId()}
        fallback={
          <div class="flex flex-col items-center justify-center h-full text-v2-text-text-muted gap-2">
            <div class="animate-spin rounded-full h-4 w-4 border-2 border-v2-text-text-muted border-t-transparent" />
            <span class="text-11-regular">Starting TUI...</span>
          </div>
        }
      >
        {(id) => (
          <Terminal
            pty={{ id: id(), title: "ellamaka tui", titleNumber: 1 }}
            class="w-full h-full"
            noPadding={true}
            isTui={true}
            onConnectError={() => setPtyId(undefined)}
          />
        )}
      </Show>
    )
  },
})

// ── Terminal View ─────────────────────────────────────────

registerView({
  id: "terminal",
  label: "Terminal",
  requiresSession: false,
  showContext: false,
  availableInOpen: true,
  render: (ctx) => {
    const [ptyId, setPtyId] = createSignal<string | undefined>(ctx.panel.termPtyId)

    createEffect(() => {
      if (ptyId()) return
      ctx.sdk.client.pty
        .create({
          cwd: ctx.directory,
          title: `Terminal (${ctx.panel.id})`,
        })
        .then((res: any) => {
          if (res.data?.id) setPtyId(res.data.id)
        })
        .catch(console.error)
    })

    onCleanup(() => {
      const id = ptyId()
      if (id) ctx.sdk.client.pty.remove({ ptyID: id }).catch(console.error)
    })

    return (
      <Show
        when={ptyId()}
        fallback={
          <div class="flex flex-col items-center justify-center h-full text-v2-text-text-muted gap-2">
            <div class="animate-spin rounded-full h-4 w-4 border-2 border-v2-text-text-muted border-t-transparent" />
            <span class="text-11-regular">Starting terminal session...</span>
          </div>
        }
      >
        {(id) => (
          <Terminal
            pty={{ id: id(), title: "Terminal", titleNumber: 2 }}
            class="w-full h-full"
            noPadding={true}
            onConnectError={() => setPtyId(undefined)}
          />
        )}
      </Show>
    )
  },
})

// ── Chat View (placeholder) ───────────────────────────────

registerView({
  id: "chat",
  label: "Chat",
  requiresSession: true,
  showContext: true,
  availableInOpen: false,
  render: (ctx) => {
    if (!ctx.session) {
      return (
        <div class="flex flex-col items-center justify-center h-full gap-2 text-v2-text-text-muted bg-v2-background-bg-base">
          <IconV2 name="edit" class="size-6 opacity-40" />
          <span class="text-12-regular">No session bound</span>
        </div>
      )
    }
    return <PanelChat panel={ctx.panel} session={ctx.session} directory={ctx.directory} sdk={ctx.sdk} spacePath={ctx.spacePath} spaceName={ctx.spaceName} />
  },
})

// ── Context View ──────────────────────────────────────────

registerView({
  id: "context",
  label: "Context",
  requiresSession: true,
  showContext: false,
  availableInOpen: false,
  render: (ctx) => {
    const sessionId = ctx.session?.id
    if (!sessionId) {
      return (
        <div class="flex flex-col items-center justify-center h-full gap-2 text-v2-text-text-muted bg-v2-background-bg-base">
          <IconV2 name="edit" class="size-6 opacity-40" />
          <span class="text-12-regular">No session bound</span>
        </div>
      )
    }
    const history = createMemoryHistory()
    history.set({ value: `/session/${sessionId}`, replace: true })
    return (
      <MemoryRouter history={history}>
        <Route path="/session/:id" component={SessionContextTab} />
      </MemoryRouter>
    )
  },
})
