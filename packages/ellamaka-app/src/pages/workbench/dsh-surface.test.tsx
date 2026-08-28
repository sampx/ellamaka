/** @jsx h */
import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import h from "solid-js/h"
import { DshIframe } from "./dsh-surface"

/**
 * The DSH iframe embeds the DSH web UI under the same-origin `/dsh/` path
 * (single-port scheme, DESIGN-dsh-poc §2.1). The iframe src is always `/dsh/`,
 * never a second-port URL.
 */
describe("DshIframe", () => {
  test("renders the DSH iframe at /dsh/", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    render(() => <DshIframe />, host)

    const iframe = host.querySelector<HTMLIFrameElement>('iframe[title="DSH"]')
    expect(iframe).not.toBeNull()
    expect(iframe!.getAttribute("src")).toBe("/dsh/")

    host.remove()
  })
})
