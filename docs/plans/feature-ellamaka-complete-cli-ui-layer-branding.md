# feature-ellamaka-complete-cli-ui-layer-branding

## Metadata

- **Type**: feature
- **Target Project**: ellamaka
- **Project Path**: projects/ellamaka/
- **Project Type**: standard
- **Created**: 2026-06-01
- **Status**: verifying

## Scope Assessment

- **Complexity**: Medium
- **Confidence**: High

## Goal

替换 CLI 入口（`src/index.ts`、`src/temporary.ts`）、错误格式化（`src/cli/error.ts`）和选定的 CLI 命令文件（`src/cli/cmd/*.ts`）中用户可见的 `"opencode"` 硬编码字符串为品牌常量导入。覆盖 yargs `scriptName()`/`describe()`、`prompts` 输出、`console.log` 运行时消息及 `Process.spawn` 子进程调用中的二进制名称，完成 CLI 用户可见层的完整品牌化。

范围外（保留 opencode 命名）：文件系统路径（`.opencode/`、`opencode.json`）、npm 包名、内部标识符（ProviderID、Context tag）、`opencode.ai` URL、默认 auth 用户名（如 `'opencode'`）。

## Technical Context

### Architecture Context

P1-02 已完成构建产物和版本号品牌化（binary 名、release channel、VERSION_PREFIX）。但 CLI 用户界面仍有 ~25 处硬编码 `"opencode"` 字符串暴露给用户，分布在 11 个 CLI 命令文件中。这些字符串通过 yargs `scriptName()`、`describe()`、`prompts.log()`、`console.log` 及 `Process.spawn` 子进程调用输出。

品牌化模式沿用已有 extract-package 方案：`packages/ellamaka/branding.ts` 导出 `BINARY_NAME`、`BINARY_TITLE`，上游文件通过 `import` 引用，每个文件 1-2 行注入。

### Research Findings

**统计方法**：`rg "[Oo]pen[Cc]ode" packages/opencode/src/cli/cmd/ --include="*.ts"` → 筛选 describe/prompts/console.log 中的用户可见字符串。

**字符串分布**（11 文件，~25 处替换）：

| 文件 | 替换数 | 类型 |
|------|--------|------|
| `index.ts` | 3 | scriptName ×2 + startsWith |
| `temporary.ts` | 1 | scriptName |
| `upgrade.ts` | 3 | describe + prompts ×2 |
| `uninstall.ts` | 3 | describe + intro + goodbye |
| `web.ts` | 1 | describe |
| `thread.ts` | 2 | describe ×2 |
| `error.ts` | 2 | 错误提示 ×2 |
| `serve.ts` | 2 | describe + console.log |
| `run.ts` | 2 | describe ×2 |
| `tui/attach.ts` | 1 | describe |
| `pr.ts` | 5 | describe + println + spawn ×2 + die |
| `mcp.ts` | 1 | prompts.outro |

**排除项**：600+ import 路径、100+ Context tag、opencode.json 引用、npm 包名、内部 URL、默认 auth 用户名。

**参考资料**：
- `projects/ellamaka/docs/BRANDING.md` — 品牌化清单与合并策略（§4.3-4.5 CLI 方案、§10 路径决策）
- `projects/ellamaka/docs/DESIGN.md` — 适配层设计

### Key Decisions

- D-01: `scriptName(BINARY_NAME)` 一步覆盖 yargs 自动生成的 help/usage/error 前缀 — 最大杠杆，最少侵入
- D-02: 显式字符串使用 `${BINARY_NAME}` 模板字面量替换 — 保持类型安全，无运行时字符串替换开销
- D-03: `opencode.json` 配置文件名在错误提示中保留不变 — 属文件系统兼容性约定（BRANDING.md §10），非品牌声明
- D-04: 包管理器命令（`npm uninstall -g opencode-ai`）不替换 — 上游 npm 包名，ellamaka 不控制
- D-05: `BINARY_TITLE = "Ellamaka"` 用于首字母大写场景（卸载界面标题、感谢语）

### Key Interfaces

`packages/ellamaka/branding.ts` 导出接口：

```ts
export const BINARY_NAME = "ellamaka"       // CLI 命令名，小写
export const BINARY_TITLE = "Ellamaka"      // 展示用标题，首字母大写
export const VERSION_PREFIX = "ellamaka"    // 版本前缀
export const CHANNEL_RELEASE = "ellamaka"   // release channel
export const CHANNEL_DEV = "ellamaka-main"  // dev channel
```

上游文件引用模式（每文件）：
```ts
import { BINARY_NAME } from "../../ellamaka/branding"
```

## In Scope

- `scriptName()` 从 `"opencode"` → `BINARY_NAME`（index.ts、temporary.ts）
- `startsWith("opencode ")` → `startsWith(BINARY_NAME + " ")`（index.ts）
- 11 个 CLI 命令文件的 describe/prompts/console.log 硬编码字符串替换
- `pr.ts` 中 `Process.spawn`/`Process.text` 的二进制名替换（子进程调用需知道自己的二进制名）
- `bun typecheck` 验证 + 全 CLI 范围 grep 验证

## Out of Scope

- `.opencode/` 目录、`opencode.json` 配置文件名 — 文件系统兼容性约定（BRANDING.md §10）
- `opencode.db`、`opencode-sfx`、`opencode-clipboard.png` — 运行时临时文件名
- `@opencode-ai/*` import 路径 — npm 包名，非用户可见
- `opencode.ai` URL — 无替代域名
- 包管理器命令（`npm uninstall -g opencode-ai`） — 上游 npm 包名
- `"# opencode"` shell PATH 标记 — 历史兼容
- `ProviderID.opencode` — 内部 provider 标识符
- uninstall.ts 中 `cleanShellConfig()` 的 `"# opencode"` 匹配逻辑 — 属安装产物标记
- `run.ts:282`、`tui/attach.ts:46` default auth username `'opencode'` — 系统默认值，非 CLI 品牌名
- `providers.ts:301` `"opencode auth provider"` — 内部 provider ID 描述
- `"http://opencode.internal"` — 内部通信 URL

## Business Rules Impact

N/A — 无业务规则变更。纯字符串替换，不影响系统行为。

### 同步确认
- [ ] 已将上述变更同步到 `BUSINESS_RULES.md`

## Affected Files

| Component | Files | Operation | Role |
|-----------|-------|-----------|------|
| branding | `packages/ellamaka/branding.ts` | 修改 | 新增 `BINARY_TITLE` 常量 |
| CLI entry | `packages/opencode/src/index.ts` | 修改 | `scriptName` + `startsWith` 替换 |
| CLI entry (temp) | `packages/opencode/src/temporary.ts` | 修改 | `scriptName` 替换 |
| upgrade cmd | `packages/opencode/src/cli/cmd/upgrade.ts` | 修改 | describe + prompts 替换 |
| uninstall cmd | `packages/opencode/src/cli/cmd/uninstall.ts` | 修改 | describe + intro + goodbye 替换 |
| web cmd | `packages/opencode/src/cli/cmd/web.ts` | 修改 | describe 替换 |
| tui cmd | `packages/opencode/src/cli/cmd/tui/thread.ts` | 修改 | describe ×2 替换 |
| error format | `packages/opencode/src/cli/error.ts` | 修改 | 错误提示字符串替换 |
| serve cmd | `packages/opencode/src/cli/cmd/serve.ts` | 修改 | describe + console.log 替换 |
| run cmd | `packages/opencode/src/cli/cmd/run.ts` | 修改 | describe ×2 替换 |
| attach cmd | `packages/opencode/src/cli/cmd/tui/attach.ts` | 修改 | describe 替换 |
| pr cmd | `packages/opencode/src/cli/cmd/pr.ts` | 修改 | describe + spawn + println + die 替换 |
| mcp cmd | `packages/opencode/src/cli/cmd/mcp.ts` | 修改 | prompts.outro 替换 |
| brand doc | `docs/BRANDING.md` | 修改 | §4.3-4.5 CLI 品牌化方案 + §10 路径决策 |

## Acceptance Criteria

### Agent Verification

1. [x] `scriptName` 不再硬编码 `"opencode"` — `rg 'scriptName\("opencode"\)' packages/opencode/src/ -c` = 0
2. [x] `scriptName` 使用品牌常量 — `rg 'scriptName\(BINARY_NAME\)' packages/opencode/src/index.ts packages/opencode/src/temporary.ts -c` = 2
3. [x] `BINARY_TITLE` 常量存在 — `rg 'BINARY_TITLE' packages/ellamaka/branding.ts -c` ≥ 1
4. [x] CLI 命令 describe 中无 `"opencode"` 硬编码 — `rg '"opencode' packages/opencode/src/cli/cmd/upgrade.ts packages/opencode/src/cli/cmd/uninstall.ts packages/opencode/src/cli/cmd/web.ts packages/opencode/src/cli/cmd/tui/thread.ts packages/opencode/src/cli/cmd/serve.ts packages/opencode/src/cli/cmd/run.ts packages/opencode/src/cli/cmd/tui/attach.ts packages/opencode/src/cli/cmd/pr.ts -c` = 0
5. [x] 错误提示中 `opencode` 已替换 — `rg '"[^"]*opencode does not' packages/opencode/src/cli/error.ts -c` = 0 AND `rg 'opencode models' packages/opencode/src/cli/error.ts -c` = 0
6. [x] mcp.ts outro 已替换 — `rg '"Add servers with: opencode' packages/opencode/src/cli/cmd/mcp.ts -c` = 0
7. [x] `bun typecheck` exit 0（从 `packages/opencode` 执行）

### User Validation

#### Scenario 1: CLI help 输出使用 ellamaka 品牌
- Goal: 确认 help 文本不再显示 opencode 命令名
- Precondition: 构建 ellamaka CLI 二进制
- User Actions:
  1. 运行 `ellamaka --help`
  2. 观察 usage 行和命令列表
- Expected Result: usage 行显示 `ellamaka [command]`，命令描述中无 `opencode` 字样

#### Scenario 2: 升级/卸载界面使用 ellamaka 品牌
- Goal: 确认升级提示和卸载界面使用 ellamaka 名称
- Precondition: 构建 ellamaka CLI 二进制
- User Actions:
  1. 运行 `ellamaka upgrade --help`
  2. 运行 `ellamaka uninstall --help`
  3. 观察 describe 文本
- Expected Result: 显示 `upgrade ellamaka to...`、`uninstall ellamaka...`

#### Scenario 3: 错误提示中 CLI 命令名为 ellamaka
- Goal: 确认错误提示中的命令参考使用 ellamaka
- Precondition: 构建 ellamaka CLI 二进制
- User Actions:
  1. 触发模型未找到错误（如配置不存在的模型）
  2. 观察错误输出
- Expected Result: 提示 `Try: \`ellamaka models\` to list available models`（非 `opencode`）

- [ ] 用户已完成上述功能验证并确认结果符合预期

## Implementation

### Task 1: CLI 入口脚本名品牌化

**Verification Intent**: AC#1, AC#2, AC#3

**Behavior**: `ellamaka --help` 输出 usage 行为 `ellamaka [command]`，所有 yargs 自动生成的错误/帮助文本使用 `ellamaka` 前缀。`temporary.ts`（Zed/shell 集成的临时 CLI 入口）同理。

**Files**: `packages/opencode/src/index.ts`, `packages/opencode/src/temporary.ts`

**Pre-read**: N/A

**Design**:
在 `src/index.ts` 和 `src/temporary.ts` 顶部添加 `import { BINARY_NAME } from "../../ellamaka/branding"`，将 `.scriptName("opencode")` 替换为 `.scriptName(BINARY_NAME)`。`src/index.ts` 中 `show()` 函数的 `startsWith("opencode ")` 替换为 `startsWith(BINARY_NAME + " ")`，确保 help 输出检测逻辑使用新品牌名。

**TDD**: false — 字符串替换，无需测试。Reason: 纯常量引用变更，不涉及逻辑分支或边界条件。验证依赖构建后 `--help` 输出检查。

**Changes**:
1. `src/index.ts`: 新增 `import { BINARY_NAME } from "../../ellamaka/branding"`
2. `src/index.ts:62`: `startsWith("opencode ")` → `startsWith(BINARY_NAME + " ")`
3. `src/index.ts:72`: `.scriptName("opencode")` → `.scriptName(BINARY_NAME)`
4. `src/temporary.ts`: 新增 `import { BINARY_NAME } from "../../ellamaka/branding"`
5. `src/temporary.ts:13`: `.scriptName("opencode")` → `.scriptName(BINARY_NAME)`

**Verify**:
`rg "scriptName\(\"opencode\"\)" packages/opencode/src/ --include='*.ts' -c` = 0

**Done**:
任务产出：index.ts 和 temporary.ts 使用 BINARY_NAME 常量控制 CLI 命令名
- [x] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 2: CLI 命令描述与用户提示品牌化

**Verification Intent**: AC#4, AC#5, AC#6

**Behavior**: 所有 CLI 命令的 `--help` 输出和运行时 prompts/console.log 消息使用 ellamaka 品牌名，不再出现 `opencode` 作为 CLI 命令引用。`pr.ts` 中 `Process.spawn(["opencode",...])` 子进程调用使用正确的二进制名。

**Files**: `packages/opencode/src/cli/cmd/upgrade.ts`, `packages/opencode/src/cli/cmd/uninstall.ts`, `packages/opencode/src/cli/cmd/web.ts`, `packages/opencode/src/cli/cmd/tui/thread.ts`, `packages/opencode/src/cli/error.ts`, `packages/opencode/src/cli/cmd/serve.ts`, `packages/opencode/src/cli/cmd/run.ts`, `packages/opencode/src/cli/cmd/tui/attach.ts`, `packages/opencode/src/cli/cmd/pr.ts`, `packages/opencode/src/cli/cmd/mcp.ts`

**Pre-read**: `packages/ellamaka/branding.ts`（确认 BINARY_NAME、BINARY_TITLE 常量）

**Design**:
每文件新增 1 行 import，将硬编码 `"opencode"` 字符串替换为模板字面量 `${BINARY_NAME}` 或 `${BINARY_TITLE}`。

- `uninstall.ts` 中 `prompts.intro()` 和 goodbye 消息使用 `BINARY_TITLE`（首字母大写："Uninstall Ellamaka"、"Thank you for using Ellamaka!"）
- `error.ts` 中仅替换 MCP 错误和 models 提示两处，保留 `"(opencode.json) provider..."` 不变
- `pr.ts` 中 `Process.spawn(["opencode",...])` 和 `Process.text(["opencode",...])` 的二进制名使用 `BINARY_NAME` 常量而非字符串字面量
- `serve.ts:20` 中 `` `opencode server listening...` `` → `` `${BINARY_NAME} server listening...` ``

**不替换项**：
- `run.ts:282` / `tui/attach.ts:46` default auth username `'opencode'` — 系统默认值
- `error.ts:43` `"(opencode.json) provider..."` — 配置文件约定

**TDD**: false — 字符串替换，无需测试。

**Changes**:
1. `upgrade.ts`: import → describe + 2 处 prompts.log 替换
2. `uninstall.ts`: import → describe + intro(BINARY_TITLE) + goodbye(BINARY_TITLE)
3. `web.ts`: import → describe
4. `thread.ts`: import → 2 处 describe
5. `error.ts`: import → MCP 错误 + models 提示
6. `serve.ts`: import → describe + console.log
7. `run.ts`: import → 2 处 describe
8. `tui/attach.ts`: import → describe
9. `pr.ts`: import → describe + println + spawn ×2 + die
10. `mcp.ts`: import → prompts.outro

**Verify**:
```bash
# 所有 describe 中无硬编码 opencode
rg '"opencode' packages/opencode/src/cli/cmd/upgrade.ts \
  packages/opencode/src/cli/cmd/uninstall.ts \
  packages/opencode/src/cli/cmd/web.ts \
  packages/opencode/src/cli/cmd/tui/thread.ts \
  packages/opencode/src/cli/cmd/serve.ts \
  packages/opencode/src/cli/cmd/run.ts \
  packages/opencode/src/cli/cmd/tui/attach.ts \
  packages/opencode/src/cli/cmd/pr.ts -c
# → 0

# error.ts 中仅允许 opencode.json 引用存在
rg '"[^"]*opencode does not' packages/opencode/src/cli/error.ts -c  # → 0
rg 'opencode models' packages/opencode/src/cli/error.ts -c           # → 0
rg 'opencode.json' packages/opencode/src/cli/error.ts -c            # → ≥ 1（保留）

# mcp.ts outro 已替换
rg '"Add servers with: opencode' packages/opencode/src/cli/cmd/mcp.ts -c  # → 0
```

**Done**:
任务产出：10 个 CLI 命令文件的 describe/prompts/spawn 全部使用品牌常量
- [x] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 3: TypeScript 类型检查验证

**Verification Intent**: AC#7

**Behavior**: 所有 import 路径正确，模板字面量类型匹配，无编译错误。

**Files**: `packages/opencode/`（类型检查覆盖整个包）

**Pre-read**: N/A

**Design**:
运行 `bun typecheck` 从 `packages/opencode` 目录验证所有 import 和类型使用正确。如存在类型错误，根据错误信息修正导入路径或类型引用。

**TDD**: false — 验证任务，非开发任务。Reason: 类型检查是验证手段，不是开发目标。

**Changes**:
1. 从 `packages/opencode` 目录执行 `bun typecheck`
2. 如有错误，修正后重新验证，直至 exit 0

**Verify**:
`cd packages/opencode && bun typecheck` exit 0

**Done**:
任务产出：类型检查通过，所有品牌常量 import 路径和模板字面量类型正确
- [x] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

## Delegation Strategy

| Wave | Task | 执行者 | 依赖 | 委派理由 |
|------|------|--------|------|---------|
| 1 | Task 1 | fae | 无 | CLI 入口（2 文件），独立于命令文件 |
| 1 | Task 2 | fae | 无 | 命令文件（10 文件），与 Task 1 文件不交集 |
| 2 | Task 3 | fae | Task 1, Task 2 | 依赖前两个 Task 完成后验证类型 |

Wave 1 并行执行（Task 1 和 Task 2 无文件交集），Wave 2 串行验证。
