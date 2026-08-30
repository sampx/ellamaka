import { describe, expect, test } from "bun:test"

/**
 * B-02 regression: `fileTree.toggle` must read and write the Workbench
 * `display.showFileTree` state so the command and the settings File tree toggle
 * drive the SAME state and produce the SAME UI effect. It must not read the
 * legacy settings/layout sources any longer.
 *
 * Coverage boundary: `useWorkbenchCommands` is a hook over the full Workbench
 * provider/harness stack, so this gates the wiring at the source level
 * (the `panel-chat-route.test.ts` convention).
 */
describe("fileTree.toggle command wiring (B-02)", () => {
  test("conditions registration and toggle selection on wb.display().showFileTree", async () => {
    const source = await Bun.file(new URL("./use-workbench-commands.tsx", import.meta.url)).text()

    // The command's visibility gate reads the Workbench display state.
    expect(source).toContain("const shown = () => wb.display().showFileTree")

    // The toggle action flips the same state (not a legacy layout/settings toggle).
    expect(source).toContain('onSelect: () => wb.setDisplay("showFileTree", !wb.display().showFileTree)')

    // No remaining legacy-fileTree wiring.
    expect(source).not.toContain("layout.fileTree.toggle")
    expect(source).not.toContain("settings.general.showFileTree()")
  })
})
