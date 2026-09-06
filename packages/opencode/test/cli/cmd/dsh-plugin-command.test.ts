import { describe, expect, test } from "bun:test"
import { DshPluginCommand } from "@/cli/cmd/dsh-plugin"
import { DshDumpConfigCommand } from "@/cli/cmd/dsh-dump-config"

describe("dsh CLI command definition", () => {
  test("dsh plugin command is a dsh subcommand", () => {
    expect(String(DshPluginCommand.command)).toBe("plugin <action> [pkg]")
    expect(DshPluginCommand.describe).toContain("manage dsh plugins")
  })

  test("dsh dump-config command is a dsh subcommand", () => {
    expect(String(DshDumpConfigCommand.command)).toBe("dump-config")
    expect(DshDumpConfigCommand.describe).toBe("dump composed dsh patch layers for a profile without booting")
  })

  test("dsh subcommands register under one parent without shadowing (yargs regression)", () => {
    // Both commands must be visible as dsh children — the earlier bug had
    // `dsh plugin ...` shadowed by `dsh dump-config` (or vice versa) when each
    // was registered as an independent top-level `dsh ...` command.
    expect(String(DshPluginCommand.command).startsWith("dsh ")).toBe(false)
    expect(String(DshDumpConfigCommand.command).startsWith("dsh ")).toBe(false)
  })
})
