import { describe, expect, test } from "bun:test"

/**
 * B-01 regression: the file viewer must load its file on the initial mount so
 * the panel never sits in a permanent "empty" state. The loading effect must
 * NOT be deferred past the first run.
 *
 * Coverage boundary: a full behavioral mount pulls the File/SDK provider stack
 * plus the `Dynamic` file component and `ScrollView` — that graph does not
 * render under the solid-js/h test harness (empty DOM even with module mocks).
 * Following the `panel-chat-route.test.ts` convention, the regression is gated
 * at the source level: if a future edit reintroduces `{ defer: true }` on the
 * `file.load` effect, this test fails. A behavioral mount test would require a
 * dedicated component harness and is tracked as a follow-up.
 */
describe("FileViewerPanel load-on-mount (B-01)", () => {
  test("triggers file.load on the initial effect run (not deferred)", async () => {
    const source = await Bun.file(new URL("./file-viewer-panel.tsx", import.meta.url)).text()

    // The load effect must not defer past mount. `defer: true` would leave the
    // viewer permanent "empty" until the path changes, which never happens here.
    const idx = source.indexOf("void file.load(path())")
    expect(idx).toBeGreaterThan(-1)
    const effectBlock = source.slice(Math.max(0, idx - 40), idx + 40)
    expect(effectBlock.includes("defer")).toBe(false)

    // The loader is wired to the current file path (not a stale captured path).
    expect(source).toContain("void file.load(path())")
  })
})
