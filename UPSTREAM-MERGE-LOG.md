# ellamaka 上游合并记录

## 分支策略

| 分支 | 用途 | 说明 |
|------|------|------|
| `main` | 主分支 | ellamaka 定制代码的稳定版本 |
| `dev` | 上游跟踪 | 与 upstream/dev 保持同步，作为合并基准 |

**合并流程**：在隔离分支（如 `merge/upstream-vX.Y.Z`）上合并 `upstream/dev`，解决冲突后 fast-forward 到 `main`。

> **2026-05-06 补充**：`scripts/merge-upstream.sh` 已废弃删除。上游变更规模太大（200+ commits/次），核心冲突集中在 `config.ts`、`paths.ts`、`skill/index.ts` 等 ellamaka 定制文件，无法用脚本自动解决，每次合并都需要分析 Plan + 人工适配。`DELETED_PREFIXES` 的自动删除仍可用一行命令替代：`git merge ... && git diff --name-only --diff-filter=U | grep -f <(printf "%s\n" "${DELETED_PREFIXES[@]}") | xargs git rm`。

## Remotes

| Remote | URL | 用途 |
|--------|-----|------|
| `origin` | `sampx/ellamaka` | fork 仓库 |
| `upstream` | `anomalyco/opencode` | 上游官方仓库 |

## 已精简的组件

初次 fork 时移除了与 ellamaka 无关的上游组件（commit `77585fa19`，1830 文件，-396k 行），合并时通过 `scripts/merge-upstream.sh` 的 `DELETED_PREFIXES` 自动保持删除：

| 前缀 | 说明 |
|------|------|
| `packages/desktop/`、`desktop-electron/` | 桌面端（Electron + Tauri） |
| `packages/enterprise/`、`console/`、`function/` | SaaS/Cloud 后台（计费、工作空间管理、认证） |
| `packages/containers/` | Docker 构建 |
| `packages/web/`、`docs/` | 网站、文档站点 |
| `packages/extensions/`、`identity/` | VS Code 扩展、品牌素材 |
| `packages/slack/`、`zen/` | Slack bot、API 代理 |
| `sdks/` | Python SDK |
| `github/` | GitHub Action |
| `infra/` | SST 基础设施（AWS/Cloudflare） |
| `nix/`、`flake.nix`、`flake.lock` | Nix 构建 |
| `install` | Shell 安装脚本 |
| `script/`（仅上游） | 上游发布/CI 脚本（保留 `scripts/merge-upstream.sh` 等） |
| `specs/`、`sst.config.ts`、`sst-env.d.ts` | 上游 spec 和 SST 配置 |
| `.github/`（仅上游 workflow） | 上游 CI/CD（保留部分 issue template） |

每次合并时，命中以上前缀的 modify/delete 冲突自动选择保持删除。

---

## 定制代码合并策略

> 来源：`AGENTS.md` → "Upstream Merge Conflict Minimization"

ellamaka 所有定制必须遵循以下规则，以最小化每次上游合并的冲突面：

1. **新文件优先**：定制逻辑放在独立新文件（如 `wopal-space.ts`），不嵌入上游源文件。上游文件只保留最小注入点（一个 `import` + 一个 `yield*` 调用）。

2. **闭包注入代替 Service 传递**：新模块需要访问上游内部（闭包、Effect Service）时，通过回调接口注入——不直接传递 Service 对象。避免上游类型变更泄漏到新模块。

3. **提前返回门卫**：定制分支用 `if (flag) { ... return result }` 在上游主流程之前执行，确保上游对主流程的变更永不与定制代码同区域冲突。

4. **提取共享辅助函数**：当上游逻辑需被定制分支复用时（如 `applyPostMerge()`），提取为命名辅助函数在上游文件中，两路径共用——不复制逻辑。

5. **禁止格式化重排**：不对上游文件的 import 顺序、依赖项、对象 key 做任何重排。这些噪音 diff 会成倍放大合并冲突窗口。

---

## 合并历史

### 2026-04-27 | upstream v1.14.25 → v1.14.28

- **Commit**: `7e8f3bba0` on `main`
- **上游范围**: 91 commits (`f2d4d816f..61eabfc60`), 155 files changed, +7738/-2560
- **Plan**: `docs/products/ellamaka/plans/done/20260427-chore-ellamaka-merge-upstream-dev-v11428.md`

**上游核心变更**:
- HttpApi 桥接端点扩充：session 路由、sync 路由、workspace 读写、TUI/PTY 路由、事件流
- Go 页面更新：DeepSeek 图标、models 端点、定价更新
- 可配置 shell 选择 + 桌面设置 UI
- npm config 重构、Installation service 统一为 Effect Service
- OpenTUI 升级（0.1.104 → 0.1.105）
- 版本: v1.14.25 → v1.14.28

**冲突解决策略**:
- `bun.lock`: 接受上游版本
- `installation/index.ts`: 手动将 ellamaka 定制移植到上游新的 Interface 结构（`result: { makeRuntime, NpmConfig }`）
- 71 个 modify/delete 冲突: 保留上游删除（SaaS/Cloud 无关文件）
- `packages/opencode/src/config/wopal-space.ts`: 从 `config.ts` 中提取为独立模块，减少 merge 冲突面

**保留的 ellamaka 定制**（9 项）:
- WOPAL_HOME 路径系统（`core/global.ts`, `config/paths.ts`）
- `DISABLE_AGENTS_SKILLS` 开关（`core/flag/flag.ts`）
- `WOPAL_SPACE` 模式标志
- `.wopal/bin` 目录检测（`installation/index.ts`）
- `ellamaka-main` 构建通道（禁升级）
- wopal-space 配置注入（`config/wopal-space.ts` + `config/config.ts`）
- `OPENCODE_LOG_LEVEL` 环境变量传递
- 独立 `.agents` 技能目录扫描（`skill/index.ts`）
- `.wopal` 路径清理（`uninstall.ts`）

**验证结果**:
- typecheck: 通过
- build: 成功

---

### 2026-04-26 | upstream v1.14.19 → v1.14.25

- **Commit**: `eb609485` on `main`
- **上游范围**: 186 commits (`224548d87..f2d4d816f`), 349 files changed
- **Plan**: `docs/products/ellamaka/plans/chore-ellamaka-merge-upstream-dev-v11425.md`

**上游核心变更**:
- 包重命名: `@opencode-ai/shared` → `@opencode-ai/core`
- 文件迁移: `flag.ts`、`global/index.ts` 从 opencode 包移至 core 包
- Zod → Effect Schema 全面迁移
- 14+ HTTP API 桥接端点
- 版本: v1.14.19 → v1.14.25

**冲突解决策略**:
- DELETED_PREFIXES 自动删除 140+ 文件（desktop/web/enterprise/slack 等）
- 定制逻辑从旧位置（opencode 包）移植到新位置（core 包）:
  - `core/global.ts`: WOPAL_HOME 环境变量 + `~/.wopal/ellamaka/*` 路径
  - `core/flag/flag.ts`: `DISABLE_AGENTS_SKILLS` 开关
  - `opencode/src/installation/index.ts`: `.wopal/bin` 路径检测
  - `opencode/src/skill/index.ts`: `.agents` 独立技能目录
- 所有 `@opencode-ai/shared` import 更新为 `@opencode-ai/core`

**验证结果**:
- typecheck: 6 包全部通过
- test: 2124 pass / 6 fail（6 fail 为上游已知问题）
- 已知问题: skill 测试在 Effect Schema 迁移后无法正确扫描临时目录

---

### 2026-04-21 | 初始合并（813 commits）

- **Commit**: `8312e78` on `main`
- **上游范围**: 813 commits, 415 files changed
- **分叉点**: `500dcfc58` (2026-04-03)
- **Plan**: `docs/products/ellamaka/plans/done/20260421-118-chore-config-merge-upstream-opencode-into-ellamaka.md`

**上游核心变更**:
- Effect Schema 重构（config 模块拆分为 15+ 子模块）
- 大规模架构变更

**保留的 ellamaka 定制**:
- `WOPAL_HOME` 环境变量支持
- `~/.wopal/ellamaka/*` 路径结构
- `ai.wopal.managed` plist domain
- `OPENCODE_DISABLE_AGENTS_SKILLS` 独立开关
- `.agents` 独立技能目录控制
