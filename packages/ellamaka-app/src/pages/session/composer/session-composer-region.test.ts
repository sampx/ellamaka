import { describe, expect, test } from "bun:test"
import { promptSurfaceMode } from "./session-composer-surface"

describe("promptSurfaceMode", () => {
  test("keeps the prompt mounted while a permission or question request blocks the session", () => {
    expect(promptSurfaceMode({ blocked: true, child: false })).toBe("prompt-disabled")
  })

  test("renders an interactive prompt when nothing blocks the session", () => {
    expect(promptSurfaceMode({ blocked: false, child: false })).toBe("prompt")
  })

  test("shows the child-session surface even while blocked", () => {
    expect(promptSurfaceMode({ blocked: true, child: true })).toBe("child-disabled")
    expect(promptSurfaceMode({ blocked: false, child: true })).toBe("child-disabled")
  })

  test("blocked toggling never unmounts the prompt surface", () => {
    const before = promptSurfaceMode({ blocked: false, child: false })
    const during = promptSurfaceMode({ blocked: true, child: false })
    const after = promptSurfaceMode({ blocked: false, child: false })

    expect(before).toBe("prompt")
    expect(during).toBe("prompt-disabled")
    expect(after).toBe("prompt")
  })

  test("keeps PromptInput mounted in the region instead of gating it on blocked", async () => {
    const source = await Bun.file(new URL("./session-composer-region.tsx", import.meta.url)).text()

    expect(source).not.toContain("<Show when={!props.state.blocked()}>")
    expect(source).toContain("promptSurfaceMode(")
    expect(source).toContain("PromptSurfaceGate")
  })
})
