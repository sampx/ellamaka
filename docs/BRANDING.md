# ellamaka Branding Guide

ellamaka 对上游 opencode 源码的品牌化改造清单。每条记录：改了什么、在哪、用什么模式、为什么。

---

## 1. 核心品牌常量

**位置**：`packages/ellamaka/branding.ts`

```ts
export const BINARY_NAME = "ellamaka"
export const VERSION_PREFIX = "ellamaka"
export const CHANNEL_RELEASE = "ellamaka"
export const CHANNEL_DEV = "ellamaka-main"
```

**模式**：独立包（零侵入）。所有上游文件通过 env 或 import 引用这些常量，不在上游源码中硬编码品牌值。

---

## 2. 构建产物品牌

### 2.1 Binary 名称

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/script/build.ts` | `const BINARY_NAME = process.env.BINARY_NAME \|\| "opencode"` → 构建循环中所有硬编码 `"opencode"` 替换为 `BINARY_NAME` | **env 驱动**：默认保持上游行为 `"opencode"`，打包时 `BINARY_NAME=ellamaka` |
| `packages/ellamaka/build.ts` | 包装脚本：设置 `BINARY_NAME=ellamaka` 环境变量后调用上游 build.ts | **独立文件** |

**上游侵入**：build.ts 中 4 行（BINARY_NAME 常量 + outfile/name/execArgv/smoke test 中的替换）。文件中不包含 `"ellamaka"` 硬编码。

### 2.2 Release channel

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/script/build.ts` | 定义 `OPENCODE_CHANNEL` 时使用 `Script.channel`（上游原生行为） | **无侵入**：`Script` 类已支持 `OPENCODE_CHANNEL` env |
| `packages/ellamaka/build.ts` | 设置 `OPENCODE_CHANNEL=${CHANNEL_RELEASE\|CHANNEL_DEV}` | **独立文件** |

### 2.3 P1 平台矩阵

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/script/build.ts` | `--p1` flag + `p1Targets` 过滤逻辑 | **argv 驱动**：只添加 flag 和通用 filter，不包含品牌特定值 |

**上游侵入**：build.ts 中约 10 行（flag 定义 + filter 逻辑）。

### 2.4 本地构建脚本

| 文件 | 变更 | 模式 |
|------|------|------|
| `scripts/build.sh` | dist 路径 `opencode-darwin` → `ellamaka-darwin`，binary 名 `ellamaka` | **独立文件**：`scripts/` 不在上游仓库中 |

---

## 3. CLI 运行时品牌

### 3.1 版本号标识

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/index.ts` | `import { VERSION_PREFIX } from "../../ellamaka/branding"` → `.version(...)` 使用 `` `${VERSION_PREFIX}/${InstallationVersion}` `` | **import 注入**：只增加 1 行 import + 1 行模板字面量，品牌值不在文件中 |

**上游侵入**：2 行。

### 3.2 Debug 信息

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/cli/cmd/debug/index.ts` | `import { VERSION_PREFIX } from "../../../../../ellamaka/branding"` → `console.log(\`${VERSION_PREFIX} version: ${InstallationVersion}\`)` | **import 注入**：同上 |

### 3.3 未修改的 CLI 标识

| 文件 | 内容 | 原因 |
|------|------|------|
| `packages/opencode/src/index.ts` | `.scriptName("opencode")` | CLI 二进制名由编译产物决定；`.scriptName()` 影响 help 输出中的命令名，保留 `"opencode"` 减少侵入 |
| `packages/opencode/src/index.ts` | `Log.Default.info("opencode", ...)` | log service 标识，非用户可见，不修改 |

---

## 4. 数据路径品牌

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/core/src/global.ts` | **完全替换** xdg 路径系统：`~/.config/opencode/` → `~/.wopal/ellamaka/data/`、`cache/`、`config/`、`state/`，临时目录 `/tmp/opencode` → `/tmp/ellamaka` | **核心身份变更**：这不是附加功能，而是 ellamaka 的根基——所有持久化数据、配置、缓存的存储位置。上游永远不会修改 xdg 路径逻辑 |

**上游侵入**：18 行。冲突风险极低（上游不改路径系统）。

---

## 5. 安装与分发品牌

### 5.1 安装 channel

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/installation/index.ts` | `"ellamaka-main"` channel 检测，提示用户手动重建 | **嵌入**：channel 名是运行时概念，需要与 build.ts 的 channel 逻辑对齐 |

### 5.2 Release 工作流

| 文件 | 变更 | 模式 |
|------|------|------|
| `.github/workflows/publish-ellamaka.yml` | 独立于上游 `publish.yml`，只构建 CLI、4 平台矩阵、`checksums.txt`、GitHub Release | **独立文件**（零侵入） |

---

## 6. 配置系统品牌

### 6.1 WopalSpace 配置层

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/config/wopal-space.ts` | 读取 `settings.jsonc` 中的 `ellamaka` 字段 | **独立文件**（零侵入） |

### 6.2 TUI 配置路径提示

| 文件 | 变更 | 模式 |
|------|------|------|
| `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx` | `~/.wopal/ellamaka/config/tui.json` 路径提示 | **嵌入**：TUI 提示文案，与 global.ts 路径对齐 |

---

## 7. 品牌注入模式总结

| 模式 | 侵入程度 | 适用场景 | 本项目中采用的文件 |
|------|----------|----------|-------------------|
| **新文件** | 零 | 完整独立的逻辑模块 | `packages/ellamaka/branding.ts`、`build.ts`、`wopal-space.ts`、`publish-ellamaka.yml`、`scripts/build.sh` |
| **env 驱动** | 最小（1-4 行） | 构建时参数、运行时 flag | `build.ts`（BINARY_NAME）、`build.ts`（OPENCODE_CHANNEL） |
| **import 注入** | 极小（2 行） | 需要类型/常量引用的场景 | `src/index.ts`、`debug/index.ts` |
| **核心替换** | 中等（~18 行） | 不可回避的系统级身份变更 | `global.ts`（路径系统） |
| **嵌入** | 不定 | 运行时概念或文案 | `installation/index.ts`、`tips-view.tsx` |

---

## 8. 上游合并注意事项

1. **优先使用新文件**：新增 ellamaka 功能时，首先考虑能否放在 `packages/ellamaka/` 或独立新文件中，避免修改上游源码。
2. **env/import 注入优于硬编码**：如果必须改上游文件，使用 `process.env.X \|\| "upstream-default"` 或从 `packages/ellamaka/branding.ts` import，确保文件中不出现 `"ellamaka"` 硬编码。
3. **合并冲突热点**：`build.ts`（构建流程改动频繁）、`src/index.ts`（CLI 入口改动频繁）。这些文件的注入点应尽可能小（1-2 行）。
4. **合并时优先删除上游遗留**：`.github/` 下的上游 CI/CD、`packages/desktop/`、`packages/enterprise/` 等已在 `UPSTREAM-MERGE-LOG.md` 的 `DELETED_PREFIXES` 中登记，合并时自动删除。
5. **合并后验证清单**：`bun typecheck` → `BINARY_NAME=ellamaka bun run build -- --p1` → `./dist/ellamaka-darwin-*/bin/ellamaka --version`
