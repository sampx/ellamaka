import { describe, expect, test } from "bun:test"
import { migrateSettings } from "./settings"

describe("migrateSettings", () => {
  test("moves Chrome-reserved settings shortcuts to Ctrl+,", () => {
    for (const oldKeybind of ["mod+comma", "mod+,"]) {
      expect(
        migrateSettings({
          keybinds: { "settings.open": oldKeybind, "session.new": "mod+shift+s" },
        }),
      ).toEqual({
        keybinds: { "settings.open": "ctrl+comma", "session.new": "mod+shift+s" },
      })
    }
  })

  test("leaves an unrelated custom settings shortcut untouched", () => {
    const value = { keybinds: { "settings.open": "ctrl+shift+s" } }

    expect(migrateSettings(value)).toBe(value)
  })

  test("removes the retired new-layout preference while preserving other settings", () => {
    expect(
      migrateSettings({
        general: {
          autoSave: false,
          newLayoutDesigns: false,
        },
        keybinds: {
          "settings.open": "ctrl+comma",
        },
      }),
    ).toEqual({
      general: {
        autoSave: false,
      },
      keybinds: {
        "settings.open": "ctrl+comma",
      },
    })
  })
})
