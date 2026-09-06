import { describe, expect, test } from "bun:test"
import { DshDumpConfigCommand } from "@/cli/cmd/dsh-dump-config"

describe("dsh dump-config CLI command definition", () => {
  test("command configuration matches contract", () => {
    expect(DshDumpConfigCommand.command).toBe("dump-config")
    expect(DshDumpConfigCommand.describe).toBe("dump composed dsh patch layers for a profile without booting")
  })
})
