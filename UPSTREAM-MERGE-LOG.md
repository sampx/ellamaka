# ellamaka 上游合并记录

## 分支策略

| 分支 | 用途 | 说明 |
|------|------|------|
| `main` | 主分支 | ellamaka 定制代码的稳定版本 |
| `dev` | 上游跟踪 | 与 upstream/dev 保持同步，作为合并基准 |

**合并流程**：在隔离分支（如 `merge/upstream-vX.Y.Z`）上合并 `upstream/dev`，解决冲突后 fast-forward 到 `main`。

## Remotes

| Remote | URL | 用途 |
|--------|-----|------|
| `origin` | `sampx/ellamaka` | fork 仓库 |
| `upstream` | `anomalyco/opencode` | 上游官方仓库 |

## 合并历史

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
