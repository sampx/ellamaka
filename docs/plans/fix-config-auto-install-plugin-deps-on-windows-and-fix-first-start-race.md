# fix-config-auto-install-plugin-deps-on-windows-and-fix-first-start-race

## Metadata

- **Issue**: #
- **Type**: fix
- **Target Project**: ellamaka

- **Project Path**: projects/ellamaka

- **Created**: 2026-07-01
- **Status**: verifying
- **Verification Commit**: dc6706a0f2ca982cfedde6388b90ac204f40b487
- **Worktree**:
  - branch: auto-install-plugin-deps-on-windows-and-fix-first-start-race
  - path: (removed)

- **Verification Dir**: /Volumes/U500G/coding/wopal-workspace/projects/ellamaka
## Scope Assessment

- **Complexity**: Medium
- **Confidence**: High

## Goal

让 ellamaka 在 Windows（及所有平台）上自动安装本地插件声明的全部依赖，使首次启动即能成功加载插件。

## Technical Context

### Architecture Context

ellamaka 的 wopal-space 模式在启动时自动安装插件依赖（`config.ts:579-601`、`wopal-space.ts:122-125`）。流程分两步：

1. `localPluginInstallDeps(dir)` 扫描 `{plugin,plugins}/*.{ts,js}` 发现插件文件，对每个插件用 `findPathPluginPackage(spec)` 从插件文件**向上查找** `package.json`，读取 `name` 字段，生成 `{ name, version: "file:<dir>" }` 条目。
2. `installPluginDeps(dir, add)` 调用 `Npm.install(dir, { add: [{ name: "@opencode-ai/plugin", ... }, ...add] })`，通过 `@npmcli/arborist` 的 `reify` 安装。

**问题：`findPathPluginPackage` 在 Windows 上找不到正确的 package.json。**

`findPathPluginPackage`（`shared.ts:224-242`）从 spec 文件向上查找 `package.json`。在 macOS/Linux 上，`wopal-plugin.ts` 是符号链接指向 `wopal-plugin/src/index.ts`，`statSync` 跟随 symlink 后 `dirname` 得到 `wopal-plugin/src/`，向上找到 `wopal-plugin/package.json`（`name=wopal-plugin`）。在 Windows 上，`core.symlinks=false` 导致符号链接变成 25 字节文本文件或被替换为 re-export shim 文件，位于 `plugins/` 目录而非 `wopal-plugin/` 子目录内，向上查找找到的是 `~/.wopal/package.json`（无 `name` 字段）或根本找不到，导致 `localPluginInstallDeps` 收集不到 wopal-plugin，其声明的 `openai`、`@lancedb/lancedb`、`yaml`、`@opencode-ai/sdk` 等依赖不会被安装。

**竞态不存在**：plugin 加载已有 `waitForDependencies` 门控（`plugin/index.ts:208` `if (plugins.length) yield* config.waitForDependencies()`），在 `loadExternal` 之前 await 所有 dep fiber。诊断日志显示 plugin 在 `+38601ms`（38秒后台安装后）加载——`waitForDependencies` 生效了。失败原因是 `openai` 不在安装列表（Problem 1），不是竞态。

### Research Findings

**诊断证据**（Windows VM 实测）：

- `localPluginInstallDeps` 在 WOPAL_HOME 扫描到 3 个插件文件，但 `findPathPluginPackage` 全部返回 `NO package.json found upwards`。
- 在 WopalSpace/.wopal 扫描到 2 个插件文件，`findPathPluginPackage` 找到 `WopalSpace/.wopal/package.json`，但 `name` 字段为 `undefined`（该 package.json 是 ellamaka 自动生成的，只含 `@opencode-ai/plugin` 依赖），`localPluginInstallDeps` 因 `!name` 跳过。
- 结果：`installPluginDeps` 的 `add` 列表只有 `@opencode-ai/plugin`，wopal-plugin 的 `openai`、`@lancedb/lancedb` 等依赖缺失。

**关键文件系统实证**（Windows VM `dir` 命令确认）：

```
C:\Users\Sampx\.wopal\plugins\
  wopal-plugin\              <-- <DIR>，子目录确实存在
    package.json             <-- 含 name=wopal-plugin, dependencies={openai, @lancedb/lancedb, ...}
    src\
      index.ts
      ...
  wopal-plugin.ts            <-- 25 字节 shim 文件（re-export）
  session-notify.ts
  tui-ellamaka.tsx
```

`plugins/wopal-plugin/package.json` 在 Windows 上**确实存在**，含 `name=wopal-plugin` 和完整 dependencies（openai、@lancedb/lancedb、@opencode-ai/sdk、yaml、@opencode-ai/plugin）。方案 B 扫描 `plugins/*/package.json` 能找到它。

**竞态验证**：`plugin/index.ts:208` `if (plugins.length) yield* config.waitForDependencies()` 在 `loadExternal`（line 210）之前执行。`waitForDependencies`（`config.ts:877-881`）通过 `Effect.forEach(s.deps, Fiber.join)` join 所有 dep fiber。诊断日志中 plugin 在 38 秒后加载正是此 gate 生效的证据。

### Key Decisions

- D-01: 采用方案 B —— `localPluginInstallDeps` 改为直接扫描 `{plugin,plugins}/*/package.json`（子目录），不依赖从 .ts 文件向上查找。`plugins/wopal-plugin/` 子目录在所有平台都存在（含 package.json），方案 B 跨平台有效。
- D-02: 方案 C（await depFibers）不需要——`waitForDependencies`（`plugin/index.ts:208`）已 gate plugin 加载，竞态不存在。
- D-03: `localPluginInstallDeps` 新实现仍兼容 npm 类型插件（非 file 路径的 spec 跳过），保持 `file:` 协议安装方式不变。
- D-04: `localPluginInstallDeps` 只收集有 `name` 字段的 package.json，避免误收集 ellamaka 自动生成的 `WOPAL_HOME/package.json`（无 name）。扫描 `plugins/*/package.json`（子目录），不扫描 `plugins/package.json`（同级）。

### Key Interfaces

`localPluginInstallDeps` 当前签名不变：

```ts
export async function localPluginInstallDeps(dir: string): Promise<InstallDependency[]>
```

返回值不变：`{ name: string, version: string, dir: string }[]`，其中 `version` 为 `file:<dir>`。

## In Scope

- 重写 `localPluginInstallDeps`：从扫描 .ts 文件向上找 package.json 改为直接扫描 `plugins/*/package.json` 子目录
- 跨平台测试覆盖：Windows shim 文件场景、macOS/Linux symlink 场景

## Out of Scope

- 修复 Windows git symlink 问题本身（`core.symlinks=false` 导致符号链接变文本文件）——这是 wopal-cli `space init` 的职责，单独处理
- 修改 `Npm.install` 或 `@npmcli/arborist` 的安装逻辑
- 竞态修复（`waitForDependencies` 已存在，无需修改）
- 非 wopal-space 模式的插件依赖安装（普通模式已有 `config.ts:690-691` 的 `localPluginInstallDeps` 调用，会自动受益）

## Affected Files

| Component | Files | Operation | Role |
|-----------|-------|-----------|------|
| config | `packages/opencode/src/config/wopal-space.ts` | 修改 | 重写 `localPluginInstallDeps` 扫描逻辑 |
| test | `packages/opencode/test/config/wopal-space-deps.test.ts` | 创建 | `localPluginInstallDeps` 跨平台测试 |

## Acceptance Criteria

### Agent Verification

1. [x] `cd projects/ellamaka/packages/opencode && bun test test/config/wopal-space-deps.test.ts --timeout 30000` 全部 pass
2. [x] `cd projects/ellamaka/packages/opencode && bun typecheck` exit 0
3. [x] `rg -c 'package.json' packages/opencode/src/config/wopal-space.ts` ≥ 1（新扫描逻辑存在）
4. [x] `rg -c 'findPathPluginPackage' packages/opencode/src/config/wopal-space.ts` = 0（旧逻辑已移除）

### User Validation

#### Scenario 1: Windows 首次启动自动安装插件依赖
- Goal: 确认 Windows 上首次启动 ellamaka 能自动安装 wopal-plugin 的全部依赖并成功加载插件
- Precondition: Windows VM 上 WOPAL_HOME 和 WopalSpace/.wopal 的 node_modules 已清除，wopal-plugin.ts 为 shim 文件
- User Actions:
  1. 在 WopalSpace 目录运行 `ellamaka run say hi`
  2. 观察日志中无 "failed to load plugin" 错误
  3. 确认 WOPAL_HOME/node_modules 包含 openai、@lancedb/lancedb、yaml、@opencode-ai/sdk
- Expected Result: 插件加载成功，无 "Cannot find package" 错误，session 正常响应

- [x] 用户已完成上述功能验证并确认结果符合预期

#### Scenario 2: macOS 首次启动无回归
- Goal: 确认 macOS 上首次启动行为不因改动而回退
- Precondition: macOS 上清除 WOPAL_HOME/node_modules 后重新启动
- User Actions:
  1. 在 wopal-space 目录运行 `ellamaka run say hi`
  2. 观察插件加载成功
- Expected Result: 插件加载成功，行为与改动前一致

- [x] 用户已完成上述功能验证并确认结果符合预期

## Implementation

### Task 1: 重写 localPluginInstallDeps 扫描逻辑

**Verification Intent**: AC#1, AC#3, AC#4

**Behavior**:
输入 → 输出映射：
- `localPluginInstallDeps("~/.wopal")`，`plugins/wopal-plugin/package.json`（name=wopal-plugin, dependencies={openai, @lancedb/lancedb, ...}）存在 → 返回 `[{ name: "wopal-plugin", version: "file:~/.wopal/plugins/wopal-plugin" }]`
- `localPluginInstallDeps("~/.wopal")`，`plugins/wopal-plugin/package.json` 存在但无 name 字段 → 跳过（不收集）
- `localPluginInstallDeps("~/.wopal")`，`plugins/other-plugin/`（无 package.json）和 `plugins/wopal-plugin/`（有 package.json）并存 → 只收集 wopal-plugin
- `localPluginInstallDeps("~/.wopal")`，`plugins/` 下无子目录 → 返回 `[]`
- `localPluginInstallDeps("~/.wopal")`，`plugins/diag.ts`（裸文件，非子目录）存在但不影响扫描 → 不被扫描（新逻辑只扫子目录的 package.json）
- `localPluginInstallDeps("~/.wopal")`，`plugins/wopal-plugin/package.json` 和 `plugin/other/package.json` 同时存在 → 两者都收集（兼容 plugin 单数形式）

**Files**: `packages/opencode/src/config/wopal-space.ts`, `packages/opencode/test/config/wopal-space-deps.test.ts`

**Pre-read**: `packages/opencode/src/plugin/shared.ts`（了解 `findPathPluginPackage` 旧逻辑）, `packages/opencode/src/config/plugin.ts`（了解 `ConfigPlugin.load` 扫描方式）

**Design**:
分三阶段实现（RED → GREEN → REFACTOR）：

1. RED：创建测试文件 `test/config/wopal-space-deps.test.ts`，构造临时目录结构模拟真实 Windows 布局：`plugins/wopal-plugin.ts`（shim 文件）+ `plugins/wopal-plugin/package.json`（子目录含 name 和 dependencies）+ `plugins/session-notify.ts`（无子目录，不收集）。验证 `localPluginInstallDeps` 能收集到 wopal-plugin。测试边界：无 name 跳过、无子目录返回空、裸 .ts 文件不影响、plugin 单数形式兼容。

2. GREEN：重写 `localPluginInstallDeps`：
   - 移除 `ConfigPlugin.load(dir)` + `findPathPluginPackage(spec)` 逻辑
   - 改为扫描 `{dir}/plugins/*/package.json` 和 `{dir}/plugin/*/package.json`（保留 plugin 单数形式兼容）
   - 对每个找到的 `package.json`，读取 `name` 字段，有 name 则收集 `{ dir: <子目录>, name, version: "file:<子目录>" }`
   - 去重（按 dir）
   - 返回排序后的列表

3. REFACTOR：提取子目录扫描为 helper `scanPluginPackages(dir)`，保持 `localPluginInstallDeps` 简洁。移除不再需要的 `findPathPluginPackage` import（`ConfigPlugin` import 保留，因为 `wopal-space.ts:138` 还在用 `ConfigPlugin.load`）。

关键约束：
- 使用 `Filesystem` API（effect/platform）或 Node `fs`，与项目现有风格一致
- 路径分隔符跨平台：使用 `path.join`，不硬编码 `/` 或 `\`
- glob 模式 `plugins/*/package.json` 需要跨平台；可用 `Glob.scan`（`ConfigPlugin.load` 已用 `Glob.scan("{plugin,plugins}/*.{ts,js}")`）或手动 `readdirSync` + `existsSync`

**TDD**: true

**Changes**:
1. 创建 `test/config/wopal-space-deps.test.ts`，编写测试覆盖 Behavior 中的输入/输出映射，包括 Windows shim 场景（`plugins/wopal-plugin.ts` shim 文件 + `plugins/wopal-plugin/package.json` 子目录）、无 name 跳过、无子目录返回空、裸 .ts 文件不被扫描、plugin 单数形式兼容
2. 重写 `localPluginInstallDeps`：替换为扫描 `{plugin,plugins}/*/package.json`，读取 name 字段，收集有 name 的条目
3. 提取 `scanPluginPackages` helper，清理不再需要的 `findPathPluginPackage` import

**Verify**:
`cd projects/ellamaka/packages/opencode && bun test test/config/wopal-space-deps.test.ts --timeout 30000` 全部 pass

**Done**:
任务产出：`localPluginInstallDeps` 改为直接扫描 plugin 子目录的 package.json，跨平台一致，Windows shim 场景能正确收集 wopal-plugin 依赖
- [x] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

## Delegation Strategy

| Wave | Task | 执行者 | 依赖 | 委派理由 |
|------|------|--------|------|---------|
| 1 | Task 1 | fae | 无 | 核心逻辑重写，TDD 驱动，独立可测 |
