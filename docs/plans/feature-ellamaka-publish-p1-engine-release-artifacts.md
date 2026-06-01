# feature-ellamaka-publish-p1-engine-release-artifacts

## Metadata

- **Type**: feature
- **Target Project**: ellamaka
- **Project Path**: projects/ellamaka/
- **Project Type**: standard
- **Product**: wopal-space
- **Phase**: P1
- **Created**: 2026-06-01
- **Status**: executing
- **Worktree**:
  - enabled: true
  - project_type: standard
  - branch: publish-p1-engine-release-artifacts
  - path: /Users/sam/coding/wopal/wopal-workspace/.worktrees/ellamaka-publish-p1-engine-release-artifacts
  - repo_root: /Users/sam/coding/wopal/wopal-workspace/projects/ellamaka
  - base_branch: main
  - merge_target: main
  - verify_mode: direct
  - cleanup_policy: archive
- **P1 Plan ID**: P1-02
- **Depends On**: None — P1 engine release foundation
- **Unblocks**:
  - P1-05 `feat(cli): manage ellamaka engine lifecycle` — `projects/wopal-cli/docs/plans/feature-cli-manage-ellamaka-engine-lifecycle.md`
  - P1-08 `feat(site): add P1 download and installer entry` — `projects/wopal-site/docs/plans/feature-site-add-p1-download-and-installer-entry.md`

## Scope Assessment

- **Complexity**: Medium
- **Confidence**: High

## Goal

让 `wopal-cn/ellamaka` 的 publish pipeline 产出 P1 可消费的 branded release artifacts：`ellamaka-*` 命名、4 平台矩阵、`ellamaka --version` identity 和 `checksums.txt`。

## Technical Context

### Architecture Context

当前 publish pipeline 在多个层级继承上游 OpenCode 品牌：

1. `publish.yml` 以 `github.repository == 'anomalyco/opencode'` 为执行守卫 — 阻止在 `wopal-cn/ellamaka` 运行
2. `build.ts` 使用 `pkg.name`（值为 `"opencode"`）构造 artifact 名 → `opencode-darwin-arm64.zip`
3. `compile.outfile` 硬编码为 `bin/opencode` / `bin/opencode.exe`
4. Build targets 包含 12 个变体（baseline、musl、arm64 等）— P1 只需要 4 个
5. `OPENCODE_CHANNEL` define 来自 `@opencode-ai/script` 的 `Script.channel` — 上游品牌
6. `--version` 输出经由 yargs `.version()` 直接展示 `InstallationVersion`，不含产品标识
7. `debug info` 命令输出 `opencode version: ${InstallationVersion}` — 上游品牌
8. 无 `checksums.txt` 生成步骤
9. `packages/opencode/script/publish.ts` 处理 npm、Docker、AUR、homebrew — P1 不需要
10. Desktop/electron build jobs — P1 只需要 CLI engine

### Research Findings

- Phase doc §4 "Engine Distribution & Consumption"（lines 129-149）定义本 Plan 覆盖的 exit criteria
- `DISTRIBUTION.md` §2-§4 定义 artifact contract 和 P1 平台矩阵
- `build.ts` 使用 `Bun.build({ compile: { target } })` 交叉编译，单个 runner 可构建所有平台
- 上游 `publish.yml` 有 5 个 job（version, build-cli, sign-cli-windows, build-electron, publish），P1 只需其中 build-cli 的简化版本
- Windows code signing 需要 Azure Trusted Signing 基础设施，P1 不可用

**参考资料**：
- `docs/products/wopal-space/phases/wopal-space-p1-one-click-distribution.md`
- `projects/ellamaka/docs/DISTRIBUTION.md`

### Key Decisions

- D-01: 在 `build.ts` 中添加 `BINARY_NAME` 常量，默认值 `"ellamaka"`，env 可覆盖。用于 artifact 命名、outfile 和 smoke test。保持 `pkg.name` 为 `"opencode"` 以减少上游合并噪音。
- D-02: 创建独立的 `publish-ellamaka.yml` 工作流，不修改上游 `publish.yml`。避免上游合并冲突。
- D-03: 添加 `--p1` flag 到 `build.ts`，选择 P1 矩阵的 4 个 target。完整 target 列表保留。
- D-04: 在 build defines 中将 `OPENCODE_CHANNEL` 覆盖为 `'ellamaka'`（release）或 `'ellamaka-main'`（本地）。
- D-05: P1 跳过 Windows code signing。Azure Trusted Signing 是上游专属基础设施。`checksums.txt` 提供 P1 完整性保证。
- D-06: 跳过 npm publish、Docker、AUR、homebrew。这些是上游分发渠道。ellamaka 仅通过 GitHub Releases 分发。
- D-07: `--version` 输出使用 `ellamaka/${version}` 格式。仅修改 yargs handler，`InstallationVersion` 保持纯 semver 值供内部消费者使用。

### Key Interfaces

Artifact 命名契约（来自 `DISTRIBUTION.md` §4）：

```
ellamaka-darwin-arm64.zip     → bin/ellamaka
ellamaka-darwin-x64.zip       → bin/ellamaka
ellamaka-linux-x64.tar.gz     → bin/ellamaka
ellamaka-windows-x64.zip      → bin/ellamaka.exe
checksums.txt                 → SHA-256 per artifact
```

## In Scope

- `build.ts` binary branding（`ellamaka` 名称、outfile、smoke test 路径）
- `--p1` flag 实现 P1 平台矩阵筛选
- `OPENCODE_CHANNEL` ellamaka 品牌覆盖
- `--version` 输出 ellamaka identity
- `debug info` 命令品牌名替换
- 新建 `publish-ellamaka.yml` CI 工作流
- `checksums.txt` 生成与 release 上传

## Out of Scope

- `wopal ellamaka` 命令族（`install/status/serve/stop/auth`）— 下游 `wopal-cli` 依赖
- npm / Docker / AUR / homebrew 发布 — 上游分发渠道
- Windows code signing — Azure Trusted Signing 上游基础设施
- Desktop / Electron 构建 — P1 只需要 CLI engine
- `pkg.name` 修改 — 保持 `"opencode"` 减少上游合并噪音
- 自定义安装目录、自动更新、多渠道分发
- `publish.yml` 修改 — 保留上游原样，新建独立工作流

## Business Rules Impact

N/A — 无业务规则变更

### 同步确认
- [x] 已将上述变更同步到 `BUSINESS_RULES.md`（文件不存在，无需同步）

## Affected Files

| Component | Files | Operation | Role |
|-----------|-------|-----------|------|
| CLI build script | `packages/opencode/script/build.ts` | 修改 | Binary branding, P1 matrix, channel 覆盖 |
| CLI entry | `packages/opencode/src/index.ts` | 修改 | `--version` 输出格式 |
| Debug command | `packages/opencode/src/cli/cmd/debug/index.ts` | 修改 | `debug info` 输出品牌名 |
| CI workflow | `.github/workflows/publish-ellamaka.yml` | 创建 | ellamaka release 工作流 |

## Acceptance Criteria

### Agent Verification

1. [ ] `rg -c 'BINARY_NAME' packages/opencode/script/build.ts` ≥ 1 — BINARY_NAME 常量存在
2. [ ] `rg 'const BINARY_NAME' packages/opencode/script/build.ts` 输出含 `ellamaka` — 默认值为 ellamaka
3. [ ] `rg -c '"--p1"' packages/opencode/script/build.ts` ≥ 1 — P1 flag 存在
4. [ ] `rg 'BINARY_NAME' packages/opencode/script/build.ts` 在 outfile 和 name 构造中均出现 — branding 覆盖完整
5. [ ] `rg 'ellamaka/' packages/opencode/src/index.ts` ≥ 1 — version handler 含 ellamaka 标识
6. [ ] `test -f .github/workflows/publish-ellamaka.yml` — 新 workflow 文件存在
7. [ ] `rg 'wopal-cn/ellamaka' .github/workflows/publish-ellamaka.yml` ≥ 1 — 指向正确仓库
8. [ ] `rg 'checksums' .github/workflows/publish-ellamaka.yml` ≥ 1 — checksums 步骤存在
9. [ ] `cd packages/opencode && bun typecheck` exit 0 — 无类型错误
10. [ ] `cd packages/opencode && bun run build -- --p1` exit 0 且 `ls dist/ellamaka-darwin-arm64* dist/ellamaka-darwin-x64* dist/ellamaka-linux-x64* dist/ellamaka-windows-x64*` 均存在 — P1 四平台 artifact 结构验证通过
11. [ ] `rg 'ellamaka version' packages/opencode/src/cli/cmd/debug/index.ts` — debug info 使用品牌名
12. [ ] `cd packages/opencode && bun test --timeout 30000` exit 0 — main engine package convention check 通过
13. [ ] `bunx actionlint .github/workflows/publish-ellamaka.yml` exit 0 — workflow 语法和 action 结构有效

### User Validation

#### Scenario 1: ellamaka release branding 验证

- Goal: 确认 release workflow 产出正确品牌的 artifacts 并可在 `wopal-cn/ellamaka` 运行
- Precondition: 代码已合并到 `wopal-cn/ellamaka` main 分支
- User Actions:
  1. 在 `wopal-cn/ellamaka` 触发 publish-ellamaka workflow（手动 dispatch 或 push tag）
  2. 查看 GitHub Release 页面和 artifacts
  3. 下载 `ellamaka-darwin-arm64.zip`，解压，运行 `./ellamaka --version`
- Expected Result:
  - Release 包含 `ellamaka-darwin-arm64.zip`, `ellamaka-darwin-x64.zip`, `ellamaka-linux-x64.tar.gz`, `ellamaka-windows-x64.zip`
  - Release 包含 `checksums.txt`
  - 解压后 binary 名为 `ellamaka`（macOS/Linux）或 `ellamaka.exe`（Windows）
  - `ellamaka --version` 输出 `ellamaka/{version}` 格式

- [ ] 用户已完成上述功能验证并确认结果符合预期

## Implementation

### Task 1: build.ts branding、P1 matrix 和 version identity

**Verification Intent**: AC#1, AC#2, AC#3, AC#4, AC#5, AC#9, AC#10, AC#11

**Behavior**: `build.ts` 使用 `ellamaka` 作为 binary/artifact name。`--p1` flag 将 targets 收缩为 darwin-arm64、darwin-x64、linux-x64 (glibc)、windows-x64 四个平台。`OPENCODE_CHANNEL` 在 release 构建时为 `ellamaka`。本地 `--p1` 构建产出四个平台的 `dist/ellamaka-{os}-{arch}/bin/ellamaka` 或 `ellamaka.exe`。`ellamaka --version` 输出 `ellamaka/{version}` 格式。

**Files**: `packages/opencode/script/build.ts`, `packages/opencode/src/index.ts`, `packages/opencode/src/cli/cmd/debug/index.ts`

**Pre-read**: `packages/opencode/script/build.ts`（全文）, `packages/opencode/src/index.ts`（L70-80）, `packages/opencode/src/cli/cmd/debug/index.ts`（全文）

**Design**:

build.ts 修改策略（最小化上游合并噪音）：

1. 在 import 区之后、`process.chdir(dir)` 之前添加 `BINARY_NAME` 常量：
   ```ts
   const BINARY_NAME = process.env.BINARY_NAME || "ellamaka"
   ```

2. 在现有 flag 定义旁添加 P1 flag：
   ```ts
   const p1Flag = process.argv.includes("--p1")
   ```

3. Target 过滤逻辑 — 在 `targets` 赋值后（现有 `singleFlag` 过滤之后）追加 P1 过滤：
   ```ts
   const p1Targets = p1Flag
     ? targets.filter((t) =>
         (t.os === "darwin" && t.arch === "arm64") ||
         (t.os === "darwin" && t.arch === "x64") ||
         (t.os === "linux" && t.arch === "x64" && t.abi === undefined && t.avx2 !== false) ||
         (t.os === "win32" && t.arch === "x64" && t.avx2 !== false)
       )
     : targets
   ```
   后续循环使用 `p1Targets` 而非 `targets`。

4. Artifact name 构造：将 `pkg.name` 替换为 `BINARY_NAME`：
   ```ts
   const name = [
     BINARY_NAME,  // 替换 pkg.name
     item.os === "win32" ? "windows" : item.os,
     item.arch,
     item.avx2 === false ? "baseline" : undefined,
     item.abi === undefined ? undefined : item.abi,
   ].filter(Boolean).join("-")
   ```

5. `compile.outfile`：替换硬编码 `"opencode"`：
   ```ts
   outfile: `dist/${name}/bin/${BINARY_NAME}`,
   ```

6. `compile.target`：将 `pkg.name` 替换为 `BINARY_NAME`：
   ```ts
   target: name.replace(BINARY_NAME, "bun") as any,
   ```

7. Smoke test 路径：替换硬编码 `"opencode"`：
   ```ts
   const binaryPath = `dist/${name}/bin/${BINARY_NAME}`
   ```

8. `OPENCODE_CHANNEL` define 覆盖：
   ```ts
   OPENCODE_CHANNEL: `'${Script.release ? "ellamaka" : "ellamaka-main"}'`,
   ```

9. Release upload 步骤中 `opencode` 路径已通过 `name` 变量间接使用 `BINARY_NAME`，无需额外修改。

src/index.ts 修改（L75）：
```ts
.version("version", "show version number", `ellamaka/${InstallationVersion}`)
```

debug/index.ts 修改（L59）：
```ts
console.log(`ellamaka version: ${InstallationVersion}`)
```

**TDD**: false — CI/release 脚本和 CLI 入口修改，不适合单元测试。验证通过本地 build smoke test 和 typecheck。

**Changes**:
1. 在 `build.ts` import 区后添加 `BINARY_NAME` 常量和 `p1Flag` 定义
2. 在 `allTargets` 定义后、`targets` 赋值链中追加 P1 过滤逻辑
3. 将 name 构造中 `pkg.name` 替换为 `BINARY_NAME`
4. 将 `compile.outfile` 硬编码 `bin/opencode` 替换为 `bin/${BINARY_NAME}`
5. 将 `compile.target` 中 `name.replace(pkg.name, ...)` 替换为 `name.replace(BINARY_NAME, ...)`
6. 将 smoke test 路径中 `bin/opencode` 替换为 `bin/${BINARY_NAME}`
7. 将 `OPENCODE_CHANNEL` define 替换为 ellamaka 品牌值
8. 将 `src/index.ts` L75 的 `.version()` 第三个参数改为 template literal 加入 ellamaka 前缀
9. 将 `src/cli/cmd/debug/index.ts` L59 的 `"opencode version"` 改为 `"ellamaka version"`

**Verify**:
```bash
cd packages/opencode && bun test --timeout 30000 && bun typecheck && bun run build -- --p1 && ls dist/ellamaka-darwin-arm64* dist/ellamaka-darwin-x64* dist/ellamaka-linux-x64* dist/ellamaka-windows-x64*
```

**Done**:
任务产出：build.ts 产出 ellamaka 品牌 binary，支持 P1 矩阵，`--version` 和 `debug info` 输出 ellamaka identity
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 2: publish-ellamaka.yml release workflow 和 checksums

**Verification Intent**: AC#6, AC#7, AC#8

**Behavior**: 新建 `.github/workflows/publish-ellamaka.yml` 在 `wopal-cn/ellamaka` 仓库运行。工作流只构建 CLI（无 desktop/electron），产出 4 平台 artifacts，生成 `checksums.txt`（SHA-256），上传到 GitHub Release。不执行 npm/Docker/AUR/homebrew 发布。

**Files**: `.github/workflows/publish-ellamaka.yml`

**Pre-read**: `.github/workflows/publish.yml`（了解上游结构和复用 actions）, `packages/opencode/script/build.ts`（了解 artifact 产出路径）

**Design**:

新建独立的 ellamaka release 工作流，3 个 job：

**Job 1: version**
- Runner: ubuntu-latest
- 条件: `github.repository == 'wopal-cn/ellamaka'`
- 在 workflow YAML 中内联 version/tag/release 推导逻辑：`version` 从 tag（`v*` push）或 `workflow_dispatch` 输入解析，`release` 按 tag push 或 dispatch `release` 条件为 true 时启用，`tag` 派生为 `v{version}`。
- 如果是 `workflow_dispatch` 且有 `version` 输入，使用输入值，并派生 `tag=v<version>`
- `release` boolean 按 tag push 或显式 dispatch release 条件派生，不重新发明一套版本判断逻辑
- Output: `version`, `release`, `tag`

**Job 2: build-cli**
- Runner: ubuntu-latest
- Needs: version
- Checkout + setup bun
- 运行 `./packages/opencode/script/build.ts --p1`
- Env: `BINARY_NAME=ellamaka`, `OPENCODE_VERSION` from version job
- 上传 4 个具体 build outputs（使用 `actions/upload-artifact@v4`）：
  - `dist/ellamaka-darwin-arm64.zip`
  - `dist/ellamaka-darwin-x64.zip`
  - `dist/ellamaka-linux-x64.tar.gz`
  - `dist/ellamaka-windows-x64.zip`
- release job 下载后必须先验证 4 个文件都存在，再生成 checksums 和发布

**Job 3: release**
- Runner: ubuntu-latest
- Needs: [version, build-cli]
- 条件: `needs.version.outputs.release != ''`
- 下载所有 artifacts 到 `dist/` 目录
- 生成 `checksums.txt`:
  ```bash
  cd dist && sha256sum ellamaka-*.zip ellamaka-*.tar.gz > checksums.txt
  ```
- 创建/更新 GitHub Release，workflow rerun 必须可重复执行：
  ```bash
  if gh release view "v${version}" --repo wopal-cn/ellamaka >/dev/null 2>&1; then
    gh release upload "v${version}" dist/ellamaka-*.zip dist/ellamaka-*.tar.gz dist/checksums.txt \
      --repo wopal-cn/ellamaka --clobber
  else
    gh release create "v${version}" dist/ellamaka-*.zip dist/ellamaka-*.tar.gz dist/checksums.txt \
      --repo wopal-cn/ellamaka --title "ellamaka v${version}" --generate-notes
  fi
  ```

触发条件：
```yaml
on:
  workflow_dispatch:
    inputs:
      version:
        description: "Override version (optional)"
        required: false
        type: string
  push:
    tags:
      - 'v*'
```

权限: `contents: write`（创建 release 需要）

跳过的上游组件：Windows signing、desktop build、npm publish、Docker、AUR、homebrew。

新 workflow 不得包含 `anomalyco/opencode` guard、`opencode-*` artifact paths、Windows signing、desktop/electron、npm/Docker/AUR/homebrew steps 或 upstream upload targets。

**TDD**: false — CI workflow 文件，不适合单元测试。验证通过 workflow 语法检查和实际触发。

**Changes**:
1. 创建 `.github/workflows/publish-ellamaka.yml` 完整工作流文件
2. 定义触发条件（workflow_dispatch + push tags）
3. 添加 version job（简化版，支持版本输入和 git tag 推断）
4. 添加 build-cli job，调用 `build.ts --p1`，设置 `BINARY_NAME=ellamaka` 环境变量
5. 添加 release job，生成 checksums，创建 GitHub Release 并上传所有文件
6. release job 支持 release 已存在时 `gh release upload --clobber`，确保 rerun 不因 tag/release 已存在失败
7. 确认 workflow 不包含 OpenCode upstream release leftovers（repo guard、opencode artifact、signing、desktop、npm/Docker/AUR/homebrew）

**Verify**:
```bash
bunx actionlint .github/workflows/publish-ellamaka.yml && rg 'workflow_dispatch|push:' .github/workflows/publish-ellamaka.yml && rg 'actions/upload-artifact@v4|actions/download-artifact@v4|gh release (create|upload)' .github/workflows/publish-ellamaka.yml && rg 'sha256sum .*checksums.txt' .github/workflows/publish-ellamaka.yml && rg 'BINARY_NAME=ellamaka|--p1' .github/workflows/publish-ellamaka.yml && ! rg 'anomalyco/opencode|opencode-|Trusted Signing|build-electron|npm publish|docker|homebrew|AUR' .github/workflows/publish-ellamaka.yml
```

**Done**:
任务产出：`publish-ellamaka.yml` 可在 `wopal-cn/ellamaka` 运行，产出 branded artifacts + checksums
- [ ] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

## Delegation Strategy

| Wave | Task | 执行者 | 依赖 | 委派理由 |
|------|------|--------|------|---------|
| 1 | Task 1 | fae | 无 | build.ts/CLI entry 代码变更，需理解 Bun build API 和 ellamaka 内部结构 |
| 1 | Task 2 | fae | 无 | 独立 workflow 文件创建，与 Task 1 编辑不同文件，可并行 |

Wave 1 两个 Task 文件不交集，可并行执行。完成后 Wopal 运行 AC Verify 命令验证产出。
