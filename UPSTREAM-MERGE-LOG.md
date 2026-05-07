# ellamaka 上游合并记录

## 分支策略

| 分支 | 用途 | 说明 |
|------|------|------|
| `main` | 主分支 | ellamaka 定制代码的稳定版本 |
| `dev` | 上游跟踪 | 与 upstream/dev 保持同步，作为合并基准 |

**合并流程**：从 `upstream/dev` 拉取 → 在 `main` 上执行 `git merge upstream/dev` →
解决冲突 → 验证 → 提交。复杂合并可在 worktree 隔离分支进行，完成后 fast-forward 到 `main`。

## Remotes

| Remote | URL | 用途 |
|--------|-----|------|
| `origin` | `sampx/ellamaka` | fork 仓库 |
| `upstream` | `anomalyco/opencode` | 上游官方仓库 |

## 已精简的组件（DELETED_PREFIXES）

每次合并时，命中以下前缀的 modify/delete 冲突自动选择保持删除（`git rm`）：

| 前缀 | 说明 |
|------|------|
| `packages/desktop/`、`desktop-electron/` | 桌面端（Electron + Tauri） |
| `packages/enterprise/`、`console/`、`function/` | SaaS/Cloud 后台 |
| `packages/containers/` | Docker 构建 |
| `packages/web/`、`docs/` | 网站、文档站点 |
| `packages/extensions/`、`identity/` | VS Code 扩展、品牌素材 |
| `packages/slack/`、`zen/` | Slack bot、API 代理 |
| `sdks/` | Python SDK |
| `github/` | GitHub Action |
| `infra/` | SST 基础设施（AWS/Cloudflare） |
| `nix/`、`flake.nix`、`flake.lock` | Nix 构建 |
| `install` | Shell 安装脚本 |
| `script/`（仅上游） | 上游发布/CI 脚本 |
| `specs/`、`sst.config.ts`、`sst-env.d.ts` | 上游 spec 和 SST 配置 |
| `.github/`（仅上游 workflow） | 上游 CI/CD |

首次 fork 时共移除 1830 文件（-396k 行，`77585fa19`）。后续合并每次自动删除 100~310+ 命中文件。

## 定制代码合并策略

> 来源：`AGENTS.md` → "Upstream Merge Conflict Minimization"

ellamaka 所有定制必须遵循以下规则，以最小化每次上游合并的冲突面：

1. **新文件优先**：定制逻辑放在独立新文件（如 `wopal-space.ts`），不嵌入上游源文件。
   上游文件只保留最小注入点（一个 `import` + 一个 `yield*` 调用）。

2. **闭包注入代替 Service 传递**：新模块需要访问上游内部（闭包、Effect Service）时，
   通过回调接口注入——不直接传递 Service 对象。避免上游类型变更泄漏到新模块。

3. **提前返回门卫**：定制分支用 `if (flag) { ... return result }` 在上游主流程之前执行，
   确保上游对主流程的变更永不与定制代码同区域冲突。

4. **提取共享辅助函数**：当上游逻辑需被定制分支复用时（如 `applyPostMerge()`），
   提取为命名辅助函数在上游文件中，两路径共用——不复制逻辑。

5. **禁止格式化重排**：不对上游文件的 import 顺序、依赖项、对象 key 做任何重排。
   这些噪音 diff 会成倍放大合并冲突窗口。

---

## 合并历史（按时间倒序）

### 2026-05-06 ~ 07 | upstream v1.14.28 → v1.14.39

**关键提交**：

| Commit | 说明 |
|--------|------|
| `26d30a68c` | 前置：移除废弃的 `scripts/merge-upstream.sh`，更新日志 |
| `618dca9de` | **初始合并**：`git merge upstream/dev`（双亲：`26d30a68c` + `6e7c9eb82`） |
| `17d08ee11` | 修复：恢复 wopal-space runtime 在合并后的完整功能 |
| `f13ed20c4` | 修复：TUI 从 `.wopal/config/settings.*` 加载外部插件和主题 |
| `5a9548513` | 增强：`scripts/dev.sh` 支持 in-process TUI、attach/server 分流 |
| `e9ff086ff` | **收口合并**：将 worktree 分支的 TUI 修复合并入 `main`（双亲：`5a9548513` + `f13ed20c4`） |

**范围**：375 commits（`61eabfc60..6e7c9eb82`），~400 files changed

#### 上游核心变更

- Barrels 全面移除：`src/*/index.ts` 已删除，import 直接从子路径引用
- CLI `effectCmd` 迁移：20+ 子命令从 Promise 转为 Effect-native
- Instance 生命周期重构：`InstanceBootstrap` 提取为 Service，ALS 模式
- HttpApi 后端默认启用：Hono → Effect native HttpApi（Bun.serve）
- Schema 迁移：Tool、Session、Provider 域从 Zod → Effect Schema
- Desktop 包整合：`desktop-electron` → `desktop`，移除 Tauri
- Shell tool 重命名：`bash` → `shell`
- `shared` → `core` 重命名（上次合并已跟进）

#### 冲突解决

**内容冲突（6 个文件）**：

| 文件 | 冲突原因 | 处理方式 |
|------|----------|----------|
| `config/paths.ts` | `.wopal` 目录扫描 + 死代码清理 | 手动适配 |
| `config/managed.ts` | import 路径 barrels 移除 | 手动适配 |
| `skill/index.ts` | 外部技能目录扫描 + `DISABLE_AGENTS_SKILLS` 守卫 | 手动适配 |
| `bus/index.ts` | Payload `id` 字段上游变更 | 手动适配 |
| `permission/index.ts` | 调试日志注释移除 | 手动适配 |
| `cli/cmd/tui/worker.ts` | import 路径 + `OPENCODE_LOG_LEVEL` | 手动适配 |

**DELETED_PREFIXES**：310+ 文件自动 `git rm`（桌面端/web/enterprise/slack/console 等）

**Flags 注册**：上游 `Flag` 类型不含 ellamaka 定制，手动补充注册：
`OPENCODE_DISABLE_AGENTS_SKILLS`、`WOPAL_SPACE`

#### 保留的 ellamaka 定制（自动合并或手动适配）

| 定制 | 位置 | 本次状态 |
|------|------|----------|
| `tryLoadWopalSpaceConfig` 注入 | `config/config.ts` | 自动合并 ✅ |
| wopal-space 配置模块 | `config/wopal-space.ts` | 完整保留（160 行）|
| `.wopal` 目录扫描 | `config/paths.ts` | 手动适配 |
| `--wopal-space` CLI 标志 | `index.ts` | 自动合并 ✅ |
| `.wopal/bin` 路径检测 + ellamaka-main 通道 | `installation/index.ts` | 自动合并 ✅ |
| `.wopal` 路径清理 | `uninstall.ts` | 自动合并 ✅ |
| `OPENCODE_LOG_LEVEL` 环境变量 | `cli/cmd/tui/worker.ts` | 手动适配 |
| `OPENCODE_DISABLE_AGENTS_SKILLS` 守卫 | `skill/index.ts` | 手动适配 |

#### 合并后修复

**05-06 当天**（`17d08ee11`、最初 `f13ed20c4` 的部分内容）：

- `core/flag/flag.ts`：`WOPAL_SPACE` 改为 getter，修复 TUI / worker 双实例下模式识别时序问题
- `config/wopal-space.ts` + `plugin/shared.ts`：`.wopal/plugins/*` 的本地源码插件自动安装
  `file:` 依赖，不再只装 `@opencode-ai/plugin`
- `cli/cmd/tui/config/tui.ts`：`WOPAL_SPACE` 模式下过滤 `.opencode` 目录自动发现
- `core/util/log.ts` + `scripts/dev.sh`：新增 `WOPAL_DEBUG_LOG_DIR`，debug 日志落到 `$space/logs/`
- `core/global.ts` + `core/package.json` + `bun.lock`：移除 `xdg-basedir`，固定 `WOPAL_HOME` 路径体系
- `scripts/build.sh` + `scripts/dev.sh`：安装改为复制二进制；补齐 preload、in-process TUI、attach/server 分流

**05-07 TUI 补丁**（`f13ed20c4` 收口 → `e9ff086ff` merge）：

- `config/wopal-space-settings.ts`（新文件）：提取 `.wopal/config/settings.jsonc|json` 共享查找逻辑
- `cli/cmd/tui/config/wopal-space.ts`（新文件）：`WOPAL_SPACE` 模式从 `settings.*` 的 `tui` 字段加载外部 TUI 插件
- `cli/cmd/tui/config/tui.ts`：接入 `tryLoadWopalSpaceTuiConfig`，取代 `.opencode/tui.json` 依赖
- `cli/cmd/tui/plugin/runtime.ts`：本地 wopal-space 插件 theme 持久化到 `.wopal/config/themes/`
- `cli/cmd/tui/context/theme.tsx`：`getCustomThemes()` 扫描 `.wopal/config/themes/*.json`

**本次教训**：
- TUI 配置加载链独立于主 `config.ts`，需显式接入 `.wopal/settings.*` 才能在 wopal-space 模式下生效
- 合并后需验证 `WOPAL_SPACE` flag 在双实例（worker + TUI）下都能正确读取

#### 验证

- typecheck：`packages/opencode` + `packages/core` 通过
- build：成功
- test：2357 pass / 25 fail（11 skip, 2 todo）
  - 6 skill 测试：上游 skill 发现重构后已知问题
  - 19 网络/超时/时序测试：无头环境固有

---

### 2026-04-27 | upstream v1.14.25 → v1.14.28

- **Commit**：`7e8f3bba0` on `main`
- **上游范围**：91 commits（`f2d4d816f..61eabfc60`），155 files changed，+7738/-2560
- **Plan**：`docs/products/ellamaka/plans/done/20260427-chore-ellamaka-merge-upstream-dev-v11428.md`

**上游核心变更**：
- HttpApi 桥接端点扩充：session、sync、workspace 读写、TUI/PTY、事件流路由
- Go 页面更新：DeepSeek 图标、models 端点、定价更新
- 可配置 shell 选择 + 桌面设置 UI
- npm config 重构、Installation service 统一为 Effect Service
- OpenTUI 升级（0.1.104 → 0.1.105）

**冲突解决**：
- `bun.lock`：接受上游版本
- `installation/index.ts`：手动将 ellamaka 定制移植到上游新 Interface 结构
- 71 个 modify/delete 冲突：DELETED_PREFIXES 自动处理
- `config/wopal-space.ts`：从 `config.ts` 中提取为独立模块，减少后续冲突面

**保留的 ellamaka 定制（9 项）**：
WOPAL_HOME 路径系统、`DISABLE_AGENTS_SKILLS` 开关、`WOPAL_SPACE` 模式标志、
`.wopal/bin` 目录检测、ellamaka-main 构建通道、wopal-space 配置注入、
`OPENCODE_LOG_LEVEL`、独立 `.agents` 技能目录、`.wopal` 路径清理

**验证**：typecheck 通过，build 成功

---

### 2026-04-26 | upstream v1.14.19 → v1.14.25

- **Commit**：`eb6094850` on `main`
- **上游范围**：186 commits（`224548d87..f2d4d816f`），349 files changed
- **Plan**：`docs/products/ellamaka/plans/chore-ellamaka-merge-upstream-dev-v11425.md`

**上游核心变更**：
- 包重命名：`@opencode-ai/shared` → `@opencode-ai/core`
- 文件迁移：`flag.ts`、`global/index.ts` 从 opencode 包移至 core 包
- Zod → Effect Schema 全面迁移
- 14+ HTTP API 桥接端点

**冲突解决**：
- DELETED_PREFIXES 自动删除 140+ 文件
- 定制逻辑从旧位置（opencode 包）移植到新位置（core 包）：
  - `core/global.ts`：WOPAL_HOME + `~/.wopal/ellamaka/*` 路径
  - `core/flag/flag.ts`：`DISABLE_AGENTS_SKILLS` 开关
  - `opencode/src/installation/index.ts`：`.wopal/bin` 路径
  - `opencode/src/skill/index.ts`：`.agents` 独立技能目录
- 所有 `@opencode-ai/shared` import 更新为 `@opencode-ai/core`

**验证**：typecheck 6 包全部通过，test 2124 pass / 6 fail（上游已知问题）

---

### 2026-04-21 | 初始合并（813 commits）

- **Commit**：`8312e78` on `main`
- **上游范围**：813 commits，415 files changed
- **分叉点**：`500dcfc58`（2026-04-03）
- **Plan**：`docs/products/ellamaka/plans/done/20260421-118-chore-config-merge-upstream-opencode-into-ellamaka.md`

**上游核心变更**：
- Effect Schema 重构（config 模块拆分为 15+ 子模块）
- 大规模架构变更

**保留的 ellamaka 定制**：
`WOPAL_HOME` 环境变量、`~/.wopal/ellamaka/*` 路径结构、
`ai.wopal.managed` plist domain、`OPENCODE_DISABLE_AGENTS_SKILLS` 开关、
`.agents` 独立技能目录
