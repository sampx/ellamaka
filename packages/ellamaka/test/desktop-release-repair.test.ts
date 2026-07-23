import { describe, expect, test } from "bun:test"

const root = new URL("../../../", import.meta.url)

async function source(path: string) {
  return Bun.file(new URL(path, root)).text()
}

describe("desktop release repair", () => {
  test("publishes only beta or prod with one build context", async () => {
    const workflow = await source(".github/workflows/publish-ellamaka-desktop.yml")

    expect(workflow).toContain('default: "prod"')
    expect(workflow).toContain("channel: ${{ steps.version.outputs.channel }}")
    expect(workflow).toContain("OPENCODE_CHANNEL: ${{ needs.version.outputs.channel }}")
    expect(workflow).toContain("OPENCODE_VERSION: ${{ needs.version.outputs.version }}")
    expect(workflow).not.toContain("Build sidecar (Node.js runtime)")
    expect(workflow).toContain("--publish never")
  })

  test("triggers only by manual dispatch, not by tag push", async () => {
    const workflow = await source(".github/workflows/publish-ellamaka-desktop.yml")

    expect(workflow).toContain("workflow_dispatch:")
    // Match the actual trigger block, not explanatory comments that
    // reference the old push:tags design we removed.
    expect(workflow).not.toMatch(/\n  push:\s*\n\s*tags:\s*\n\s*-\s*"v\*"/)
    expect(workflow).not.toContain('github.event_name == "push"')
    expect(workflow).not.toContain("${GITHUB_REF_NAME#v}")
  })

  test("isolates beta storage and replaces repeated releases", async () => {
    const workflow = await source(".github/workflows/publish-ellamaka-desktop.yml")

    expect(workflow).toContain('CHANNEL" = "beta"')
    expect(workflow).toContain("ellamaka-desktop/beta")
    expect(workflow).toContain("list-objects-v2")
    expect(workflow).toContain("aws s3 rm")
    expect(workflow).toContain("old-release-urls")
    expect(workflow).toContain(".zip.blockmap")
    expect(workflow).toContain(".exe.blockmap")
  })

  test("injects release version and ad-hoc signs macOS", async () => {
    const config = await source("packages/ellamaka-desktop/electron-builder.config.ts")

    expect(config).toContain('identity: "-"')
    expect(config).toContain("extraMetadata")
    expect(config).toContain("OPENCODE_VERSION")
    expect(config).toContain("ellamaka-desktop/beta/latest")
  })

  test("enables isolated beta update checks", async () => {
    const constants = await source("packages/ellamaka-desktop/src/main/constants.ts")
    const updater = await source("packages/ellamaka-desktop/src/main/updater.ts")

    expect(constants).toContain('CHANNEL === "beta" || CHANNEL === "prod"')
    expect(updater).toContain('autoUpdater.allowPrerelease = CHANNEL === "beta"')
  })

  test("tag helper dispatches workflows instead of push-trigger + cancel", async () => {
    const script = await source("scripts/tag-release.sh")

    expect(script).toContain("--channel")
    expect(script).toContain('CHANNEL="prod"')
    expect(script).toContain("X.Y.Z-beta.N")
    expect(script).toContain("Desktop channel")

    // Option D: tag-release.sh owns trigger authority via gh workflow run.
    // No push:tags auto-trigger, no cancel-after-start.
    expect(script).toContain("gh workflow run")
    expect(script).toContain("--ref")
    expect(script).toContain("-f \"version=$plain_version\"")
    expect(script).toContain("workflow_dispatch")
    expect(script).toContain("dispatch_workflow")

    // Anti-patterns we removed:
    expect(script).not.toContain("gh run cancel")
    expect(script).not.toContain("--event push")
    expect(script).not.toContain("PUSHED_AT")
  })
})
