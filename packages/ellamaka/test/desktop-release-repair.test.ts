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
    expect(workflow).not.toMatch(/\n  push:\s*\n\s*tags:\s*\n\s*-\s*"v\*"/)
    expect(workflow).not.toContain('github.event_name == "push"')
    expect(workflow).not.toContain("${GITHUB_REF_NAME#v}")
  })

  test("isolates beta storage and fails closed on existing manifest", async () => {
    const workflow = await source(".github/workflows/publish-ellamaka-desktop.yml")

    expect(workflow).toContain('CHANNEL" = "beta"')
    expect(workflow).toContain("ellamaka-desktop/beta")
    // Per §9, use head-object to check for existing manifest (fail-closed),
    // not list-objects-v2 for recursive clear.
    expect(workflow).toContain("head-object")
    expect(workflow).not.toContain('aws s3 rm "s3://wopal-release/${VERSION_PREFIX}/"')
    expect(workflow).toContain("effective manifest already exists")
    expect(workflow).toContain(".zip.blockmap")
    expect(workflow).toContain(".exe.blockmap")
    // Latest manifest upload
    expect(workflow).toContain('${LATEST_PREFIX}/manifest.json')
    // TTL: versioned 30-day, latest 60-second, no legacy values
    expect(workflow).toContain("max-age=2592000")
    expect(workflow).toContain("max-age=60")
    expect(workflow).not.toContain("max-age=604800")
    expect(workflow).not.toContain("max-age=300")
    // Purge URL includes latest manifest
    expect(workflow).toContain('${LATEST_BASE}/manifest.json')
  })

  test("injects release version and ad-hoc signs macOS", async () => {
    const config = await source("packages/ellamaka-desktop/electron-builder.config.ts")

    expect(config).toContain('identity: "-"')
    expect(config).toContain("extraMetadata")
    expect(config).toContain("packageName")
    expect(config).toContain('executableName: "ellamaka"')
    expect(config).toContain("OPENCODE_VERSION")
    expect(config).toContain("OPENCODE_BUILD_ID")
    expect(config).toContain("ellamaka-desktop/beta/latest")
  })

  test("enables isolated beta update checks", async () => {
    const constants = await source("packages/ellamaka-desktop/src/main/constants.ts")
    const updater = await source("packages/ellamaka-desktop/src/main/updater.ts")

    expect(constants).toContain('CHANNEL === "beta" || CHANNEL === "prod"')
    expect(updater).toContain('autoUpdater.allowPrerelease = CHANNEL === "beta"')
  })

  test("tag helper dispatches workflows with namespaced product tags", async () => {
    const script = await source("scripts/tag-release.sh")

    // New namespaced product tag model (docs/DISTRIBUTION.md §4.1).
    // tag-release.sh accepts a product + explicit Ellamaka product version
    // and creates ellamaka-{cli,desktop}-vX.Y.Z tags. It no longer accepts
    // implicit -N suffix iteration or --retag that deletes committed tags.
    expect(script).toContain("ellamaka-cli-v")
    expect(script).toContain("ellamaka-desktop-v")
    expect(script).toContain("cli")
    expect(script).toContain("desktop")
    expect(script).toContain("all")

    // Channel validation for Desktop
    expect(script).toContain("--channel")
    expect(script).toContain("beta")
    expect(script).toContain("prod")

    // Dispatch via gh workflow run (trigger authority owned by tag-release.sh)
    expect(script).toContain("gh workflow run")
    expect(script).toContain("--ref")
    expect(script).toContain("dispatch_workflow")
    expect(script).toContain("actions/runs/([0-9]+)")
    expect(script).toContain("dispatch 未返回 workflow run ID")

    // Removed anti-patterns:
    // - No --retag (committed releases are immutable; failed attempts use
    //   explicit retry after controlled cleanup)
    expect(script).not.toContain("--retag")
    // - No implicit -N auto-increment for prod
    expect(script).not.toContain("自动递增 -N")
    // - No generic vX.Y.Z tag (must be namespaced)
    expect(script).not.toMatch(/VERSION="v\$PLAIN_VERSION"/)
  })

  test("tag helper rejects withdrawn versions before mutation", async () => {
    const script = await source("scripts/tag-release.sh")

    // Per docs/DISTRIBUTION.md §7.3, withdrawn-versions.json is the
    // permanent record of versions that must never be reused.
    expect(script).toContain("withdrawn-versions.json")
    expect(script).toContain("withdrawn")
  })

  test("tag helper supports explicit cli-version and desktop-version for all", async () => {
    const script = await source("scripts/tag-release.sh")

    // Per §8 / §11, 'all' accepts two independent product versions instead
    // of copying one version to both products.
    expect(script).toContain("--cli-version")
    expect(script).toContain("--desktop-version")
  })

  test("pins release workflows to Node 24-native official actions", async () => {
    const cli = await source(".github/workflows/publish-ellamaka.yml")
    const desktop = await source(".github/workflows/publish-ellamaka-desktop.yml")

    expect(cli).toContain("actions/checkout@v6")
    expect(cli).toContain("actions/cache@v5")

    expect(desktop).toContain("actions/checkout@v6")
    expect(desktop).toContain("actions/setup-node@v6")
    expect(desktop).toContain("actions/cache@v5")
    expect(desktop).toContain("actions/upload-artifact@v7")
    expect(desktop).toContain("actions/download-artifact@v8")
    expect(desktop).not.toContain("actions/upload-artifact@v5")
    expect(desktop).not.toContain("actions/download-artifact@v5")
  })

  test("carries build identity via release context into packages and manifests", async () => {
    const desktop = await source(".github/workflows/publish-ellamaka-desktop.yml")
    const cli = await source(".github/workflows/publish-ellamaka.yml")

    expect(desktop).toContain("OPENCODE_BUILD_ID: ${{ github.sha }}")
    expect(desktop).toContain("ELLAMAKA_RELEASE_CONTEXT_PATH")
    expect(desktop).toContain("--release-context-path release-context.json")
    expect(cli).toContain("ELLAMAKA_RELEASE_CONTEXT_PATH")
    expect(cli).toContain("--release-context-path release-context.json")
  })

  test("withdraw script requires exactly one product (cli or desktop)", async () => {
    const script = await source("scripts/withdraw-release.sh")

    expect(script).toContain("cli")
    expect(script).toContain("desktop")
    // 二选一：不能同时撤回两个产品
    expect(script).toContain("不能同时")
  })

  test("withdraw script auto-selects the previous version when version is omitted", async () => {
    const script = await source("scripts/withdraw-release.sh")

    // 无 version 参数时自动找"上一个版本"（低于当前 latest 的最高已发布版本）
    expect(script).toContain("find_previous_version")
    expect(script).toContain("ls-remote")
  })

  test("withdraw script records the version and dispatches the cleanup workflow", async () => {
    const script = await source("scripts/withdraw-release.sh")

    // 登记 withdrawn-versions.json（提交 + push）
    expect(script).toContain("withdrawn-versions.json")
    expect(script).toContain('git -C "$REPO_ROOT" commit')
    expect(script).toContain('git -C "$REPO_ROOT" push')

    // dispatch cleanup-releases.yml withdraw 模式（保留 action，脚本传参触发）
    expect(script).toContain("gh workflow run cleanup-releases.yml")
    expect(script).toContain("mode=withdraw")
    expect(script).toContain("withdraw-version")
    expect(script).toContain("fallback-version")
    expect(script).toContain("apply=true")
  })

  test("withdraw script supports explicit version and fallback", async () => {
    const script = await source("scripts/withdraw-release.sh")

    expect(script).toContain("--fallback")
    // 撤回版本不能等于 fallback
    expect(script).toContain("fallback")
  })

  test("withdraw script matches namespaced product tags", async () => {
    const script = await source("scripts/withdraw-release.sh")

    // 实际 tag 是 ellamaka-cli-vX.Y.Z / ellamaka-desktop-vX.Y.Z，
    // 不能用裸 ${product}-v* 前缀（cli-v* / desktop-v* 永远匹配不到）
    expect(script).toContain('ls-remote --tags origin "ellamaka-${product}-v*"')
    expect(script).not.toContain('ls-remote --tags origin "${product}-v*"')
  })

  test("withdraw script resolves versions within a single channel", async () => {
    const script = await source("scripts/withdraw-release.sh")

    // 版本解析必须带 channel：stable 只与 stable 比较，beta 只与 beta 比较
    expect(script).toContain("highest_released")
    expect(script).toContain("find_previous_version")
    expect(script).toContain("channel")
    // 渠道判定：-beta.N 属于 beta，其余属于 stable
    expect(script).toContain("-beta.")
  })

  test("withdraw script rejects cross-channel fallback", async () => {
    const script = await source("scripts/withdraw-release.sh")

    // 显式 --fallback 必须与撤回版本同渠道，跨渠道直接拒绝
    expect(script).toContain("--fallback")
    expect(script).toContain("渠道")
  })

  test("withdraw script maps product to full registry key", async () => {
    const script = await source("scripts/withdraw-release.sh")

    // withdrawn-versions.json 与 cleanup workflow 使用全名 key
    // （ellamaka-cli / ellamaka-desktop），脚本参数 cli|desktop 必须映射
    expect(script).toContain("ellamaka-desktop")
    expect(script).toContain("ellamaka-cli")
    // 登记与 dispatch 使用映射后的全名，而非裸参数
    expect(script).toMatch(/PRODUCT_KEY/)
  })
})
