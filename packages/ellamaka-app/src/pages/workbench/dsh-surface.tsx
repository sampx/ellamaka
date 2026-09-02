/** @jsx h */
import { type JSX } from "solid-js"
import h from "solid-js/h"
import { useServer } from "@/context/server"
import { useWorkbenchState } from "./view-store"

/**
 * Derive the DSH iframe URL from the active server URL. The DSH web UI is
 * mounted under the backend origin's `/dsh/` path (single-port scheme,
 * DESIGN-dsh-poc §2.1). The iframe must point at the backend origin, not the
 * frontend origin — in the dev two-server topology the Vite app and the
 * backend listen on different ports, so a relative `/dsh/` would resolve
 * against the frontend origin and miss the DSH mount.
 */
export function dshIframeSrc(serverUrl: string | undefined): string | undefined {
  if (!serverUrl) return undefined
  return new URL("/dsh/", serverUrl).toString()
}

/**
 * The DSH iframe: embeds the DSH web UI under the backend origin's `/dsh/`
 * path. Absent a DSH closure the iframe simply won't connect.
 */
export function DshIframe(props: { src?: string }): JSX.Element {
  return (
    <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-v2-background-bg-deep">
      <iframe
        title="DSH"
        src={props.src}
        class="h-full w-full border-0"
        allow="clipboard-write; clipboard-read"
      />
    </div>
  )
}

/**
 * Visibility styles for the keep-alive swap. Both layers stay mounted; only
 * display toggles, so the iframe never reloads and DSH session state survives
 * tab switches. Visible layer participates in layout (`contents`); hidden
 * layer drops out of layout (`none`) so the iframe cannot intercept input.
 */
export function dshSurfaceStyle(visible: boolean): { display: string } {
  return { display: visible ? "contents" : "none" }
}

/**
 * The DSH surface replaces the Assistant (general) tab content. The iframe is
 * mounted once and kept alive (visibility toggle only) so DSH session state
 * survives tab switches, mirroring the Space Keep-Alive invariant. It covers
 * the full content area below the titlebar, including the SpaceRail — the DSH
 * UI ships its own sidebar.
 */
export function DshSurface(props: { children: JSX.Element }): JSX.Element {
  const wb = useWorkbenchState()
  const server = useServer()
  const src = () => dshIframeSrc(server.current?.http.url)
  const visible = () => wb.dshVisible
  return (
    <>
      <div style={dshSurfaceStyle(visible())}>
        <DshIframe src={src()} />
      </div>
      <div style={dshSurfaceStyle(!visible())}>{props.children}</div>
    </>
  )
}
