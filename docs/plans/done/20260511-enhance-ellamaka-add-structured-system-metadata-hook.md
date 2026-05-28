# enhance-ellamaka-add-structured-system-metadata-hook

## Metadata

- **Type**: enhance
- **Target Project**: ellamaka
- **Created**: 2026-05-11
- **Status**: done

## Goal

为 `experimental.chat.system.transform` 插件 hook 新增一份可选的结构化 `systemMetadata` 输入，让插件能够直接读取核心系统提示词的语义分块，而不必再从合并后的 `system[0]` 大字符串中做脆弱解析。

## Problem

当前插件在 `experimental.chat.system.transform` 中只能拿到：

```ts
output: { system: string[] }
```

但在进入 hook 之前，ellamaka 已经把下列内容拼成了一个 header 字符串并放入 `system[0]`：

1. `agent.prompt` 或 provider prompt
2. `input.system`（来自 `prompt.ts` 的 env / instructions / skills / structured output prompt）
3. `input.user.system`

对应源码：

- `projects/ellamaka/packages/opencode/src/session/prompt.ts:1568-1577`
- `projects/ellamaka/packages/opencode/src/session/llm.ts:103-127`

这导致插件若想按真实结构展示 system prompt，只能重新从字符串中猜测边界。这个方案有两个问题：

1. 对 prompt 文案格式强依赖，稳定性差
2. 上游稍微调整 system 文本模板，插件解析就会退化

## Constraints

### 1. 最小改动，便于后续 merge 上游

- 不改现有 `output.system: string[]` 语义
- 不改 system 拼接和 cache rejoin 行为
- 不改 message 存储结构

### 2. 不影响当前 HTTP API / JS SDK

以下公共接口保持不变：

- `session.prompt` 请求体仍然是 `system?: string`
- `session.messages` 返回结构不新增字段
- 生成式 SDK (`packages/sdk/js`) 无需改动或重新生成

### 3. 对现有插件实现保持源码兼容

已有插件即使完全不读取新字段，也必须零修改继续工作。

## Design

### 方案总览

只对插件 hook 的 **input** 做一次增量扩展：

```ts
"experimental.chat.system.transform"?: (
  input: {
    sessionID?: string
    model: Model
    systemMetadata?: SystemPromptMetadata
  },
  output: {
    system: string[]
  },
) => Promise<void>
```

其中：

- `output.system` 继续作为可变的最终 system blocks 容器
- `input.systemMetadata` 提供 **pre-plugin** 的核心结构化分块
- 该字段为 optional，非 session prompt 场景允许缺失或仅提供部分信息

### 为什么放在 input，不放在 output

因为它描述的是“进入插件前，内核已知的系统提示词语义结构”，本质上是只读上下文，不是 hook 要修改的输出。

这样可以做到：

1. `output.system` 完全不变
2. 现有插件对 output 的使用零风险
3. `systemMetadata` 的含义更清晰：它是结构化输入，不承诺反映插件后续对 `output.system` 的修改

## Metadata Shape

### 类型定义

建议在 `packages/plugin/src/index.ts` 中新增导出类型：

```ts
export type SystemPromptSectionKind =
  | "agent-prompt"
  | "provider-prompt"
  | "environment"
  | "instruction"
  | "skill"
  | "structured-output"
  | "user-system"
  | "custom"

export type SystemPromptSection = {
  kind: SystemPromptSectionKind
  content: string
  source?: string
}

export type SystemPromptMetadata = {
  version: 1
  sections: SystemPromptSection[]
}
```

### 设计理由

用 `sections[]` 而不是固定嵌套对象，原因是：

1. **保序**：插件可以按真实拼接顺序消费
2. **可扩展**：上游后续新增 system block 类型时，只需增加 `kind`
3. **最小侵入**：不要求把所有 section 都拆成专门字段

### `source` 字段用途

仅在容易稳定提取的场景填写：

- `instruction`: `Instructions from: <path-or-url>` 中的 `<path-or-url>`

其他 section 暂不强求 `source`，以减少实现复杂度。

## Build Strategy

### 核心原则

`systemMetadata` 必须在 **已有语义边界仍然存在的地方** 构建，而不是在 `llm.ts` 的合并后字符串上再拆。

因此构建位置放在 `projects/ellamaka/packages/opencode/src/session/prompt.ts`。

### 在 `prompt.ts` 中构建 metadata

`prompt.ts` 当前已经同时拿到了：

- `skills`
- `env`
- `instructions`
- `agent`
- `model`
- `lastUser.system`
- `format.type === "json_schema"` 时的 structured output prompt

这正是唯一“天然有语义边界”的位置。

建议在这里构建：

1. `agent.prompt` 存在 → `agent-prompt`
2. 否则使用 `SystemPrompt.provider(model)` → `provider-prompt`
3. `env[]` → `environment`
4. `instructions[]` → `instruction`
5. `skills` → `skill`
6. `STRUCTURED_OUTPUT_SYSTEM_PROMPT` → `structured-output`
7. `lastUser.system` → `user-system`

最终把 `systemMetadata` 作为 `LLM.StreamInput` 的一个可选字段透传到 `llm.ts`。

### 在 `llm.ts` 中透传给插件

`llm.ts` 继续按现有逻辑构造：

```ts
const system: string[] = []
system.push([...].filter(Boolean).join("\n"))
yield* plugin.trigger("experimental.chat.system.transform", input, { system })
```

只新增一处：

```ts
yield* plugin.trigger(
  "experimental.chat.system.transform",
  { sessionID: input.sessionID, model: input.model, systemMetadata: input.systemMetadata },
  { system },
)
```

其余逻辑保持不变：

- `system[0]` 继续是现有 header
- `system.length > 2 && system[0] === header` 时继续 rejoin `system[1+]`
- provider 请求参数和 message 构造不变

### `agent.generate` 路径

`projects/ellamaka/packages/opencode/src/agent/agent.ts:343-344` 也会触发同一个 hook。

此路径没有 `prompt.ts` 那套 env / instructions / skills 上下文，因此建议仅提供：

```ts
systemMetadata: {
  version: 1,
  sections: [{ kind: "custom", content: PROMPT_GENERATE }],
}
```

这样插件侧可以统一读取字段，但也能通过 `kind === "custom"` 明确区分该路径。

## Compatibility Analysis

### 不影响的部分

以下范围应保持零行为变化：

1. `packages/opencode/src/server/routes/**`
2. `packages/sdk/js/**`
3. `packages/opencode/src/session/message-v2.ts`
4. `packages/opencode/src/session/message.ts`
5. `output.system` 的内容和顺序

### 插件兼容性

这是一次 **additive optional field** 变更。

已有插件如果这样写：

```ts
"experimental.chat.system.transform": (_input, output) => {
  output.system.unshift("x")
}
```

将继续正常工作，不需要改动。

### 上游 merge 风险

风险较低，原因：

1. 改动文件少
2. 主要是类型扩展和字段透传
3. 不改公共 HTTP contract
4. 不改 session 持久化 schema

## Proposed File Changes

| File | Change | Purpose |
|------|--------|---------|
| `projects/ellamaka/packages/plugin/src/index.ts` | 修改 | 新增 `SystemPromptMetadata` 相关类型，并给 `experimental.chat.system.transform` 的 input 增加可选 `systemMetadata` |
| `projects/ellamaka/packages/opencode/src/session/llm.ts` | 修改 | `LLM.StreamInput` 增加可选 `systemMetadata`，并在触发 hook 时透传 |
| `projects/ellamaka/packages/opencode/src/session/prompt.ts` | 修改 | 在语义边界仍存在时构建 `systemMetadata` 并传给 `handle.process()` |
| `projects/ellamaka/packages/opencode/src/agent/agent.ts` | 修改 | 为 `agent.generate` 路径提供最小 `systemMetadata` |
| `projects/ellamaka/packages/opencode/test/plugin/trigger.test.ts` | 修改 | 验证 hook 在扩展 input 后仍可正常触发 |
| `projects/ellamaka/packages/opencode/test/session/prompt.test.ts` 或 `test/session/llm.test.ts` | 修改 | 验证 `systemMetadata.sections` 在真实 prompt 流中按预期生成并传入插件 hook |

## Out of Scope

- 在 `session.messages` 中持久化或回放结构化 system metadata
- 修改 `session.prompt` / `session.prompt_async` HTTP payload
- 修改生成式 SDK types / client methods
- 为插件注入后的 `output.system` 再生成一份“最终结构化 metadata”
- 为 skills section 额外暴露技能名称数组、frontmatter 等二次解析数据

## Implementation Plan

### Task 1: 扩展插件 hook 类型

**Files**: `packages/plugin/src/index.ts`

**Changes**:

- 定义 `SystemPromptSectionKind`
- 定义 `SystemPromptSection`
- 定义 `SystemPromptMetadata`
- 给 `experimental.chat.system.transform` 的 input 增加 `systemMetadata?: SystemPromptMetadata`

### Task 2: 在 prompt 流中构建 metadata

**Files**: `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/llm.ts`

**Changes**:

- `LLM.StreamInput` 增加 `systemMetadata?: SystemPromptMetadata`
- `prompt.ts` 基于已有分块构建有序 `sections[]`
- 透传给 `handle.process()` → `processor` → `llm.stream()`
- `llm.ts` 调用 plugin hook 时携带 `input.systemMetadata`

### Task 3: 覆盖非 session prompt 路径

**Files**: `packages/opencode/src/agent/agent.ts`

**Changes**:

- 给 `agent.generate` 的 hook 触发补一个最小 `systemMetadata`

### Task 4: 测试与回归验证

**Files**: `packages/opencode/test/plugin/trigger.test.ts`, `packages/opencode/test/session/prompt.test.ts` 或 `packages/opencode/test/session/llm.test.ts`

**Changes**:

- 验证旧插件 hook 不受影响
- 验证真实 prompt 流中 `sections` 的 kind 顺序正确
- 验证 `instruction.source` 提取正确（若本轮实现该字段）
- 验证 `output.system` 现有行为不变

## Test Plan

### Unit / Integration

#### Case 1: Hook 类型扩展不破坏现有调用
- 在 `test/plugin/trigger.test.ts` 保留现有同步 / 异步 hook 场景
- 确认不读取 `systemMetadata` 时测试仍通过

#### Case 2: Session prompt 流生成正确的 section 顺序
- 通过临时 plugin 读取 `input.systemMetadata.sections`
- 触发一次正常 `session.prompt`
- 断言至少包含：
  - `agent-prompt` 或 `provider-prompt`
  - `environment`
  - `instruction`
  - `skill`（有 skill 时）

#### Case 3: `output.system` 行为保持不变
- 通过 plugin hook 同时读取 `input.systemMetadata` 和 `output.system`
- 确认新增 metadata 后，原有 system transform 输出路径不变

### Command Verification

- `cd projects/ellamaka/packages/opencode && bun run typecheck`
- `cd projects/ellamaka/packages/opencode && bun test --timeout 30000 test/plugin/trigger.test.ts`
- `cd projects/ellamaka/packages/opencode && bun test --timeout 30000 <新增/修改的 session 测试文件>`

## Acceptance Criteria

### Agent Verification

- [ ] 插件 hook 可以通过 `input.systemMetadata` 直接读取结构化 system sections
- [ ] 现有 `output.system` 行为与内容不变
- [ ] `session.prompt` / `session.messages` HTTP contract 无改动
- [ ] `packages/sdk/js` 无需重新生成
- [ ] `bun run typecheck` 通过
- [ ] 受影响测试通过

### User Validation

#### Scenario 1: 插件可稳定读取核心 system 结构
- Goal: 插件不再需要从 `system[0]` 里猜测 env / instructions / skills 的边界
- Precondition: 启用一个读取 `systemMetadata` 的测试插件
- User Actions:
  1. 触发一次正常对话
  2. 查看插件记录到的 `sections`
- Expected Result: 插件直接拿到有序结构化 sections，而不是只能解析合并后的 header 字符串

#### Scenario 2: 旧插件无感继续运行
- Goal: 确认新增字段不会破坏现有插件
- Precondition: 使用一个只改 `output.system`、完全不读 `systemMetadata` 的旧插件
- User Actions:
  1. 触发 system transform hook
  2. 检查插件输出
- Expected Result: 行为与改动前一致

- [ ] 用户已完成上述功能验证并确认结果符合预期

## Recommendation

本次只做 **插件 hook 级结构化 metadata**，不要顺手扩展到 `session.messages` 或生成式 SDK。

这样能以最小 diff 解决当前问题，也最利于后续 merge 上游。
