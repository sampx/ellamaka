# fix-config-align-wopal-space-detection-and-skill-loading

## Metadata

- **Type**: fix
- **Target Project**: ellamaka
- **Project Path**: projects/ellamaka/
- **Project Type**: standard
- **Created**: 2026-06-10
- **Status**: verifying
- **Worktree**:
  - branch: align-wopal-space-detection-and-skill-loading
  - path: /Users/sam/coding/wopal/wopal-workspace/.worktrees/ellamaka-align-wopal-space-detection-and-skill-loading

## Scope Assessment

- **Complexity**: Medium
- **Confidence**: High

## 目标

让 ellamaka 通过实际空间根来识别 WopalSpace，保证从空间内任意位置启动都能走完整一致的空间配置和能力加载链路。

## 技术上下文

### 架构现状

ellamaka 的 WopalSpace 判定目前分两步走，两步的搜索边界不一致。

CLI 检测阶段从 cwd 向上遍历，检查 `.wopal/config/settings.json[c]` 是否包含 `ellamaka` 键来决定是否进入空间模式。

配置加载阶段则只在 cwd 和当前 git worktree 根之间搜索 `.wopal/`。

当 ellamaka 在嵌套项目仓库（如 `projects/ellamaka/`）内启动时，检测器能穿透子仓库找到工作空间根，但加载器被卡在子仓库的 git 根边界，找不到空间根的 `.wopal/`。结果是检测说"在空间内"，但加载不到空间级配置和能力。

WopalSpace 的身份标识是空间根。空间根是最近祖先目录中 `.wopal/.git` 为文件的那个目录。`.wopal/config/settings.jsonc` 是配置覆盖层，不是身份标识。

WopalSpace 模式应是一条短路链路：在空间内走空间链路，不在空间内保持 opencode 兼容链路不动。

### 研究结论

目标 WopalSpace 加载模型：

1. 空间检测从 cwd 向上找到最近的有效空间根，上界为用户 home 目录。
2. `--no-wopal-space` 是唯一手动覆写入口，用于在空间内恢复原生 opencode 行为。
3. `--wopal-space` 删除——非空间内不能强制开启空间模式。
4. `WOPAL_SPACE_ROOT` 由检测逻辑设置，检测不到则清除，不接受用户环境变量注入。
5. 配置和能力加载器直接消费 `WOPAL_SPACE_ROOT/.wopal/`。
6. 空间模式下 skill 加载优先级：`~/.agents/skills/` → `~/.wopal/skills/` → `<空间根>/.wopal/skills/`。
7. 空间模式排除 Claude Code 提示词和 Claude Code 技能。
8. 非空间模式保持现有 opencode 兼容行为不变。

**参考资料**：
- N/A — 源行为在规划阶段直接审查。

### 关键决策

- D-01：通过 `.wopal/.git` 是否为文件来检测 WopalSpace，因为 ontology worktree 就是空间身份标识。
- D-02：向上检测上界为用户 home 目录，`~/.wopal/` 是全局用户层，不做为空间嵌套搜索边界。
- D-03：删除 `--wopal-space`，因为非空间内强制开启空间模式会产生无效状态。
- D-04：保留 `--no-wopal-space`，作为空间内恢复原生 opencode 行为的逃生舱。
- D-05：`WOPAL_SPACE_ROOT` 为进程内部状态，检测运行前忽略用户提供的同名环境变量。
- D-06：WopalSpace 配置和 TUI 配置直接从 `WOPAL_SPACE_ROOT/.wopal/` 加载，不再从 cwd 到当前 git worktree 扫描。
- D-07：保持现有 command 和 agent 的字段级合并行为——空间定义只覆盖自己声明的字段。
- D-08：保持现有 skill 和 plugin 的同名替换行为——上层同名 skill / 同 identity plugin 完整替换下层。

### 关键接口

```ts
type WopalSpaceDetection = {
  root: string
  wopalDir: string
}

function detectWopalSpace(cwd: string, options?: { home?: string }): WopalSpaceDetection | undefined
```

运行时契约：

- `WOPAL_SPACE_ROOT` 为检测到的空间根绝对路径。
- `WOPAL_SPACE` 仅保留为内部兼容状态，供已有 `Flag.WOPAL_SPACE` 消费者使用。
- `--no-wopal-space` 清除当前进程的两个内部值。

## 范围内

- 将基于 settings 文件的 WopalSpace 检测替换为基于 ontology worktree 的检测。
- 删除强制开启的 `--wopal-space` CLI 选项。
- 保留 `--no-wopal-space` 作为显式原生模式逃生舱。
- 配置和 TUI 加载使用检测到的空间根，不再依赖当前 git worktree 边界。
- WopalSpace 模式下 skill 发现加载 `~/.agents/skills/` 作为最低优先级层。
- WopalSpace 模式继续排除 Claude Code 提示词和 Claude Code 技能。
- 为空间内嵌套项目启动添加回归测试。
- 如果现有文档描述了旧 WopalSpace 行为，更新 ellamaka 项目文档。

## 范围外

- 修改非 WopalSpace 模式下的 opencode 兼容行为。
- 修改 command 和 agent 的合并语义。
- 修改 skill 和 plugin 的替换语义。
- 支持在检测不到 WopalSpace 时手动强制开启空间模式。
- 修改上游 opencode 的配置名称或路径。

## 业务规则影响

### 新增

N/A — 无业务规则变更。

### 修改

N/A — 无业务规则变更。

### 废弃

N/A — 无业务规则变更。

### 同步确认
- [ ] N/A — 无需更新 `BUSINESS_RULES.md`。

## 涉及文件

| 组件 | 文件 | 操作 | 作用 |
|------|------|------|------|
| 空间检测 | `packages/ellamaka/detect.ts`, `packages/ellamaka/test/detect.test.ts` | 修改/新建 | 通过 ontology worktree 标记检测最近 WopalSpace 根 |
| CLI 模式选择 | `packages/opencode/src/index.ts` | 修改 | 删除强制开启 flag，规范化内部空间模式状态 |
| 主配置加载 | `packages/opencode/src/config/wopal-space-settings.ts`, `packages/opencode/src/config/wopal-space.ts`, `packages/opencode/src/config/config.ts`, `packages/opencode/test/config/config.test.ts` | 修改 | 从 `WOPAL_SPACE_ROOT/.wopal/` 加载空间配置和能力 |
| TUI 配置加载 | `packages/opencode/src/cli/cmd/tui/config/wopal-space.ts`, `packages/opencode/src/cli/cmd/tui/config/tui.ts`, `packages/opencode/test/config/tui.test.ts` | 修改 | TUI 配置跟随同一条 WopalSpace 根链路 |
| Skill 加载 | `packages/opencode/src/skill/index.ts`, `packages/opencode/src/effect/runtime-flags.ts`, `packages/opencode/test/skill/skill.test.ts` | 修改 | 空间模式优先加载 `~/.agents/skills/` 并排除 Claude 技能 |
| 指令加载 | `packages/opencode/src/session/instruction.ts`, `packages/opencode/test/session/instruction.test.ts` | 修改 | 空间模式排除 Claude 提示词，不影响非空间模式 |
| 文档 | `docs/BRANDING.md`, `AGENTS.md` | 按需修改 | 记录目标 WopalSpace 行为供后续维护 |

## 验收标准

### Agent 验证

1. [x] 在 `packages/ellamaka` 下：`bun test test/detect.test.ts` 退出码 0。
2. [x] 在 `packages/opencode` 下：`bun test test/config/config.test.ts test/config/tui.test.ts test/skill/skill.test.ts test/session/instruction.test.ts` 退出码 0。
3. [x] 在 `packages/opencode` 下：`bun typecheck` 退出码 0。
4. [x] 在 `packages/opencode` 下：测试证据确认嵌套项目 cwd 启动时，即使 cwd git worktree 是嵌套项目根，也能加载 `<空间根>/.wopal/` 配置和能力。
5. [ ] 用户验证场景 2 确认 `--no-wopal-space` 恢复原生 opencode 兼容行为。此条不需要自动化测试——这是用户触发的模式切换，通过人工观察验证。

### 用户验证

#### 场景 1：从 WopalSpace 内项目仓库启动 ellamaka
- 目标：确认从 `projects/<name>/` 启动时 ellamaka 使用空间根 `.wopal/` 链路。
- 前置条件：已切换到实施分支，ellamaka 已重启，当前位于工作空间内某项目目录。
- 用户操作：
  1. 从 WopalSpace 内的嵌套项目目录启动 ellamaka。
  2. 检查由空间根 `.wopal/` 层定义的可用技能或 agent 行为。
- 预期结果：即使当前 git 仓库是嵌套项目仓库，空间级能力仍然可用。

#### 场景 2：显式关闭 WopalSpace 模式
- 目标：确认 `--no-wopal-space` 恢复原生 opencode 兼容行为。
- 前置条件：同一项目目录位于已检测到的 WopalSpace 内。
- 用户操作：
  1. 使用 `--no-wopal-space` 启动 ellamaka。
  2. 检查 WopalSpace 独有能力是否不可用。
- 预期结果：ellamaka 在本次进程中走原生 opencode 兼容链路。

- [ ] 用户已完成上述功能验证并确认结果符合预期

## Test Plan

##### Case 1: 空间根检测

- Goal: 确认 `detectWopalSpace` 通过 `.wopal/.git` 文件识别空间根，home 上界正确，非 worktree `.wopal/` 不阻塞搜索，不依赖 settings 文件
- Fixture: tmpdir 内创建多层目录，在指定层级放置 `.wopal/.git` 文件和非 worktree 的 `.wopal/` 目录
- Execution:
  - [x] Step 1: 覆盖 AC#1, AC#4 — 在 `packages/ellamaka` 下运行 `bun test test/detect.test.ts`
- Expected Evidence: 全部测试通过，`detectWopalSpace` 返回 `{ root, wopalDir }` 而非布尔值

##### Case 2: 配置和 TUI 加载

- Goal: 确认 WopalSpace 配置和 TUI 加载器直接使用 `WOPAL_SPACE_ROOT/.wopal/`，不依赖 `findWopalDirs` 和 worktree 边界
- Fixture: tmpdir 内模拟嵌套项目仓库结构，外层空间根有 `.wopal/`，内层项目为独立 git 仓库
- Execution:
  - [x] Step 1: 覆盖 AC#2, AC#3, AC#4 — 在 `packages/opencode` 下运行 `bun test test/config/config.test.ts test/config/tui.test.ts`
- Expected Evidence: 嵌套项目 cwd 下 `tryLoadWopalSpaceConfig` 正确加载空间根 `.wopal/` 的配置和能力

##### Case 3: 技能和指令加载

- Goal: 确认空间模式下 skill 链路为 `~/.agents/` → `~/.wopal/` → `.wopal/`，Claude prompt 和 Claude skill 被排除
- Fixture: tmpdir 内准备 `~/.agents/skills/`、`~/.claude/skills/`、`~/.wopal/skills/` 和空间 `.wopal/skills/` 的多层目录结构
- Execution:
  - [x] Step 1: 覆盖 AC#2, AC#3 — 在 `packages/opencode` 下运行 `bun test test/skill/skill.test.ts test/session/instruction.test.ts`
- Expected Evidence: 空间模式下 skill 优先级正确，Claude 内容被排除；非空间模式行为不变

##### Case 4: 文档契约

- Goal: 确认项目文档记录了 WopalSpace 最终运行时契约
- Fixture: 实施完成后的 `docs/BRANDING.md` 或 `AGENTS.md`
- Execution:
  - [x] Step 1: 覆盖 AC#3 — 运行 `bun typecheck && rg -l 'WOPAL_SPACE_ROOT' docs/BRANDING.md AGENTS.md`
- Expected Evidence: typecheck 通过且文档包含 `WOPAL_SPACE_ROOT` 相关描述

## 实施

### Task 1：检测 WopalSpace 根并规范化 CLI 模式

**验证意图**：AC#1, AC#5

**行为**：ellamaka 通过 `.wopal/.git` 文件检测最近空间根，上界为用户 home 目录，删除 `--wopal-space`，保留 `--no-wopal-space` 作为唯一手动覆写。

**文件**：`packages/ellamaka/detect.ts`, `packages/ellamaka/test/detect.test.ts`, `packages/opencode/src/index.ts`

**预读**：`packages/ellamaka/detect.ts`, `packages/opencode/src/index.ts`

**设计**：

将检测从布尔型 settings 文件扫描改为根路径检测。

检测器从 cwd 向上遍历到 home 目录，第一个包含 `.wopal/.git` 为文件的祖先目录即为空间根。普通 `.wopal/` 目录无 git worktree 标记的忽略，不中止搜索。

`index.ts` 删除 `--wopal-space` 选项，通过 yargs 布尔否定支持保留 `--no-wopal-space`。

检测前清除所有继承的 `WOPAL_SPACE` 和 `WOPAL_SPACE_ROOT` 值，防止用户环境变量注入。

若 `--no-wopal-space` 存在，两个值均清除；否则从检测到的空间根设置两个值。

**TDD**：true

**改动**：
1. 为检测到的根、最近根优先级、home 停止边界、非 worktree `.wopal/` 忽略、不依赖 settings 文件检测等场景编写 RED 测试。
2. 将 `detectWopalSpace` 改为返回根元数据而非布尔值。
3. 更新 `index.ts` middleware，删除强制开启 flag，从检测结果规范化内部环境状态。
4. 更新受检测器返回类型影响的调用点和测试。

**验证**：
在 `packages/ellamaka` 下：`bun test test/detect.test.ts`

**Done**：
任务产出：WopalSpace 根检测和 CLI 模式选择是确定性的，不依赖 settings 文件。
- [x] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 2：从检测到的空间根加载主配置和 TUI 配置

**验证意图**：AC#2, AC#3, AC#4, AC#5

**行为**：WopalSpace 配置加载直接使用 `WOPAL_SPACE_ROOT/.wopal/`，适用于嵌套项目仓库、空间内非 git 目录、无本地 settings 覆盖层的空间。

**文件**：`packages/opencode/src/config/wopal-space-settings.ts`, `packages/opencode/src/config/wopal-space.ts`, `packages/opencode/src/config/config.ts`, `packages/opencode/src/cli/cmd/tui/config/wopal-space.ts`, `packages/opencode/src/cli/cmd/tui/config/tui.ts`, `packages/opencode/test/config/config.test.ts`, `packages/opencode/test/config/tui.test.ts`

**预读**：`packages/opencode/src/config/wopal-space.ts`, `packages/opencode/src/config/wopal-space-settings.ts`, `packages/opencode/src/cli/cmd/tui/config/wopal-space.ts`, `packages/opencode/src/cli/cmd/tui/config/tui.ts`

**设计**：

用基于根的解析替换 `findWopalDirs`。空间模式下本地 Wopal 目录始终为 `[path.join(WOPAL_SPACE_ROOT, ".wopal")]`。

加载器不再要求 `ctx.worktree`，不再要求空间本地有 settings 文件。有本地 settings 文件时合并其中的 `ellamaka` 或 `tui` 部分；无本地 settings 文件时继续加载全局配置和能力。

普通模式不动。`--no-wopal-space` 使 WopalSpace 加载器返回 undefined，让已有原生路径继续运行。

**TDD**：true

**改动**：
1. 编写 RED 配置测试：cwd 在嵌套项目仓库内且 `WOPAL_SPACE_ROOT` 指向外层工作空间。
2. 编写 RED 配置测试：检测到空间但无 `.wopal/config/settings.jsonc`。
3. 编写 RED TUI 配置测试：同上述嵌套根场景。
4. 从 WopalSpace 配置和 TUI 依赖中移除 `findWopalDirs`。
5. 两个加载器直接使用内部根路径。

**验证**：
在 `packages/opencode` 下：`bun test test/config/config.test.ts test/config/tui.test.ts && bun typecheck`

**Done**：
任务产出：主配置和 TUI 配置一致使用检测到的 WopalSpace 根。
- [x] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 3：应用 WopalSpace 技能和指令链路

**验证意图**：AC#2, AC#3, AC#5

**行为**：WopalSpace 模式下，skill 按 `~/.agents/skills/` → `~/.wopal/skills/` → `<空间根>/.wopal/skills/` 顺序加载；Claude 技能和 Claude 提示词被排除。非 WopalSpace 模式下，现有 opencode 兼容行为不变。

**文件**：`packages/opencode/src/skill/index.ts`, `packages/opencode/src/effect/runtime-flags.ts`, `packages/opencode/src/session/instruction.ts`, `packages/opencode/test/skill/skill.test.ts`, `packages/opencode/test/session/instruction.test.ts`

**预读**：`packages/opencode/src/skill/index.ts`, `packages/opencode/src/effect/runtime-flags.ts`, `packages/opencode/src/session/instruction.ts`

**设计**：

不再用 `WOPAL_SPACE` 作为禁用所有外部技能的万能 flag。空间模式有自己的显式 skill 发现链路。

链路以 `~/.agents/skills/` 开头，使外部 agent 技能成为最低优先级层。之后 config 目录按现有顺序加载用户级和空间级 Wopal 技能。Skill 替换保持 last-write-wins。

Claude Code 提示词和技能排除直接由空间模式分支处理，不需要用户设置环境变量。

普通模式保持现有外部技能和指令逻辑不变。

**TDD**：true

**改动**：
1. 编写 RED skill 测试：空间模式下加载 `~/.agents/skills/`，且被 `~/.wopal/skills/` 和 `<空间根>/.wopal/skills/` 覆盖。
2. 编写 RED skill 测试：空间模式下不加载 `~/.claude/skills/`。
3. 编写 RED instruction 测试：空间模式下排除 Claude 提示词文件，普通模式下正常工作。
4. 重构 skill 发现逻辑，为 WopalSpace 模式显式分支。
5. 重构指令加载逻辑，通过空间模式状态排除 Claude 提示词，替代广谱外部禁用。

**验证**：
在 `packages/opencode` 下：`bun test test/skill/skill.test.ts test/session/instruction.test.ts && bun typecheck`

**Done**：
任务产出：WopalSpace 技能和指令加载按设计的短路链路运行。
- [x] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

### Task 4：文档记录最终 WopalSpace 模式契约

**验证意图**：AC#3

**行为**：项目文档以面向配置的语言记录目标 WopalSpace 运行时契约，不保留旧检测假设。

**文件**：`docs/BRANDING.md`, `AGENTS.md`

**预读**：`docs/BRANDING.md`, `AGENTS.md`

**设计**：

仅更新已描述 WopalSpace 行为的现有文档。保持文字操作性。记录根标记、短路配置链路、skill 优先级和 `--no-wopal-space` 逃生舱。不写入源码分析笔记或实施历史。

**TDD**：false — 纯文档任务。

**改动**：
1. 如存在相关文档章节，更新之。
2. 仅在后续维护者需要时添加或调整 AGENTS 指导。

**验证**：
在 `packages/opencode` 下：`bun typecheck`；然后在 `projects/ellamaka` 下：`rg -l 'WOPAL_SPACE_ROOT' docs/BRANDING.md AGENTS.md` 退出码 0。

**Done**：
任务产出：文档反映最终 WopalSpace 模式契约。
- [x] 实施 Agent 已完成上述功能开发和验证的所有步骤执行, 并确认结果符合预期（必须由实施 Agent 勾选）

---

## 委派策略

| Wave | Task | 执行者 | 依赖 | 委派理由 |
|------|------|--------|------|---------|
| 1 | Task 1 | fae | 无 | 检测和 CLI 模式是所有后续加载器的基础 |
| 2 | Task 2 | fae | Task 1 | 配置和 TUI 加载器依赖内部根契约 |
| 3 | Task 3 | fae | Task 1, Task 2 | 技能和指令加载应使用已确定的空间模式契约 |
| 4 | Task 4 | fae | Task 1, Task 2, Task 3 | 文档应反映已实施的契约 |

每 wave 顺序执行，因为内部 WopalSpace 根契约影响所有下游加载器。
