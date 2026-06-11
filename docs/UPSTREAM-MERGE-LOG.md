# ellamaka 上游合并记录

## 分支策略

| 分支 | 用途 |
|------|------|
| `main` | ellamaka 定制代码的稳定版本 |
| `dev` | 上游跟踪，与 `upstream/dev` 同步 |

合并流程和策略统一维护在 `docs/BRANDING.md` §9，此处只记录每次合并的关键元数据和值得注意的事项。

## Remotes

| Remote | URL | 用途 |
|--------|-----|------|
| `origin` | `sampx/ellamaka` | fork 仓库 |
| `upstream` | `anomalyco/opencode` | 上游官方仓库 |

## 合并历史（按时间倒序）

### 2026-06-09 | upstream v1.15.13

| 角色 | Commit | 描述 |
|------|--------|------|
| 合并基点 | `d055cd71b8` | ellamaka main 合并前的 HEAD |
| 合入目标 | `385cb69441` | upstream v1.15.13 发布 tag |
| 分叉点 | `6e7c9eb820` | `git merge-base` 共同祖先 |

**值得注意**：14 个小版本压缩合并（v1.14.39 → v1.15.13）。Zod→Effect Schema 全面迁移、RuntimeFlags Service 重构、TUI Plugin API 重写。29 个内容冲突 + ~300 个 modify/delete（精简目录自动 `git rm`）。精简新增 `packages/stats/`。

**Plan**: `chore-ellamaka-merge-upstream-opencode-v11513`

---

### 2026-05-06 | upstream v1.14.39

**值得注意**：375 commits 合并。Barrels 全面移除、CLI 命令从 Promise 迁移到 Effect-native、HttpApi 后端默认启用、`shared`→`core` 包重命名、`bash`→`shell` tool 重命名。6 个内容冲突，310+ 文件精简。

---

### 2026-04-27 | upstream v1.14.28

**值得注意**：91 commits 合并。HttpApi 桥接端点扩充、npm config 重构、Installation service 统一为 Effect Service。`config/wopal-space.ts` 独立为模块以减小后续冲突面。

**Merge commit**: `7e8f3bba0`

**Plan**: `20260427-chore-ellamaka-merge-upstream-dev-v11428`

---

### 2026-04-26 | upstream v1.14.25

**值得注意**：186 commits 合并。`@opencode-ai/shared`→`@opencode-ai/core` 包重命名，`flag.ts`、`global/index.ts` 从 opencode 包迁移到 core 包。Zod→Effect Schema 迁移。

**Merge commit**: `eb6094850`

**Plan**: `chore-ellamaka-merge-upstream-dev-v11425`

---

### 2026-04-21 | 初始合并（813 commits）

**值得注意**：ellamaka 首次正式合并上游。Effect Schema 重构，config 模块拆分为 15+ 子模块。分叉点 `500dcfc58`。

**Merge commit**: `8312e78`

**Plan**: `20260421-118-chore-config-merge-upstream-opencode-into-ellamaka`
