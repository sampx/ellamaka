import { describe, expect, test } from "bun:test"
import { isEllamakaTuiTitle, shouldUseTuiTerminalMode } from "./terminal-tui-mode"

describe("terminal TUI mode", () => {
  test("recognizes the titles emitted by the Ellamaka TUI", () => {
    expect(isEllamakaTuiTitle("Ellamaka")).toBe(true)
    expect(isEllamakaTuiTitle("ellamaka | review the panel layout")).toBe(true)
  })

  test("does not classify shell or unrelated terminal titles as Ellamaka TUI", () => {
    expect(isEllamakaTuiTitle("sam@MacMini: ~/coding")).toBe(false)
    expect(isEllamakaTuiTitle("ellamaka build output")).toBe(false)
  })

  test("enables full-bleed interaction for a dedicated or nested Ellamaka TUI only", () => {
    expect(
      shouldUseTuiTerminalMode({
        isDedicatedTui: true,
        isEllamakaTitle: false,
        isAlternateBuffer: false,
      }),
    ).toBe(true)

    expect(
      shouldUseTuiTerminalMode({
        isDedicatedTui: false,
        isEllamakaTitle: true,
        isAlternateBuffer: true,
      }),
    ).toBe(true)

    expect(
      shouldUseTuiTerminalMode({
        isDedicatedTui: false,
        isEllamakaTitle: true,
        isAlternateBuffer: false,
      }),
    ).toBe(false)

    expect(
      shouldUseTuiTerminalMode({
        isDedicatedTui: false,
        isEllamakaTitle: false,
        isAlternateBuffer: true,
      }),
    ).toBe(false)
  })
})
