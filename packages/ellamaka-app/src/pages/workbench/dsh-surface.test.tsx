/** @jsx h */
import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import h from "solid-js/h"
import { DshIframe, dshIframeSrc, dshSurfaceStyle } from "./dsh-surface"

/**
 * The DSH iframe embeds the DSH web UI under the backend origin's `/dsh/` path
 * (single-port scheme, DESIGN-dsh-poc §2.1). The iframe src is derived from the
 * active server URL so it points at the backend origin, not the frontend origin
 * (which differs in the dev two-server topology: Vite serves the app, the
 * backend serves /dsh).
 */
describe("dshIframeSrc", () => {
  test("derives the backend /dsh/ URL from a server URL", () => {
    expect(dshIframeSrc("http://localhost:4097")).toBe("http://localhost:4097/dsh/")
    expect(dshIframeSrc("http://127.0.0.1:4097")).toBe("http://127.0.0.1:4097/dsh/")
  })

  test("preserves an existing path on the server URL", () => {
    expect(dshIframeSrc("http://localhost:4097/base")).toBe("http://localhost:4097/dsh/")
  })

  test("returns undefined for an empty server URL", () => {
    expect(dshIframeSrc("")).toBeUndefined()
    expect(dshIframeSrc(undefined)).toBeUndefined()
  })
})

describe("DshIframe", () => {
  test("renders the DSH iframe at the given src", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    render(() => <DshIframe src="http://localhost:4097/dsh/" />, host)

    const iframe = host.querySelector<HTMLIFrameElement>('iframe[title="DSH"]')
    expect(iframe).not.toBeNull()
    expect(iframe!.getAttribute("src")).toBe("http://localhost:4097/dsh/")

    host.remove()
  })
})


/**
 * DshSurface keep-alive contract (DESIGN-dsh-poc §10): the DSH iframe is the
 * Assistant tab's content, so both layers must stay mounted and only the
 * display style toggles — unmounting would reload the iframe and destroy DSH
 * session state, violating the Space Keep-Alive invariant.
 */
describe("dshSurfaceStyle keep-alive", () => {
  test("visible layer participates in layout, hidden layer drops out", () => {
    expect(dshSurfaceStyle(true)).toEqual({ display: "contents" })
    expect(dshSurfaceStyle(false)).toEqual({ display: "none" })
  })
})
