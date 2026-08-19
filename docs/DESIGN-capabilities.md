# DESIGN-capabilities — Effect 原生能力路线设计

> **定位**：路线终审（`DESIGN-refactor-cordis.md` §12，2026-08-19）之后的主线设计。承载四个主题：能力包工艺（Effect 原生插件化）、plugin 统一声明面（配置化）、权限收敛、实施序列。cordis 相关设计（含边缘线使用方式）归属 `DESIGN-refactor-cordis.md`，本文档不重复。
>
> **创建时间**：2026-08-19

## 1. 背景与目标

终审结论 C4 指出：Plan 1 验证的真正工艺是"独立包 + 最小注入点"，cordis 只是当时选择的协议载体。本文档将该工艺平移到纯 Effect 形态，并承接两个真实诉求——配置化定制能力（原 ConfigBridge 转性）、权限体系收敛（原 Step C guard 叙事撤销后的正确目标）。

设计原则：简洁可预测（启动期静态装配、声明即全部、无热重载）、fails loud（错配立即报错）、upstream 跟踪友好（新文件优先、注入点最小化）、每项投入由真实需求驱动。

## 2. 能力包工艺（Effect 原生插件化）

### 2.1 目标形态

```
upstream 文件（最小污染，每处 3-5 行）
  ├─ upstream 原生 plugin hooks（零污染，upstream 自己维护的 API）
  │    experimental.chat.system.transform、chat.params、tool.execute.* …
  │    → system prompt 注入等能力今天即可用，一行不用改
  └─ 最小注入点（optional Effect service，缺省 no-op）
       prompt.ts loop 点（Plan 1 已留下）
       tool registry 点（Plan 1 已留下）
       compaction 入口点（新增，pruner 用）
       RunState busy 点（新增，Inbox 用）

独立能力包（packages/，workspace 包，逻辑全部住在这里）
  ellamaka-cap-session-query   4 工具 + Storage 检索 + toolCall 血缘
  ellamaka-cap-schedule        3 工具 + 三态定时 + prompt() 唤醒
  ellamaka-cap-subagent        多后端契约 + provider 注册表（首后端包装 task）
  ellamaka-cap-pruner          确定性裁剪（纯函数算法 + compaction 嵌入实现）
  ellamaka-cap-inbox           两级队列（RunState 嵌入实现）

装配层（ellamaka 自己的新文件，非 upstream）
  读 settings.json plugin 声明 → 组合 Layer → server 装配点一次 provide
```

### 2.2 工艺规则

- **独立包**：能力逻辑全部住在 `packages/ellamaka-cap-*/`，不散落 upstream 文件。包依赖 Effect 服务（Storage/Bus/SessionPrompt/Config）走 workspace 依赖，同运行时零桥接税。
- **createLayer 工厂**：每个能力包暴露 `createLayer(options) → Effect Layer`，含 no-op 缺省实现（未装配时行为与现状一致）。
- **最小注入点**：内核流程缺口以 optional service 注入（`Effect.serviceOption`，缺省 no-op 直连），每处 3-5 行，upstream rebase 冲突面分钟级。
- **钩子优先**：upstream 原生 plugin hooks 已覆盖的需求（如 system prompt 注入）直接用钩子，不建注入点。
- **A 类例外**：算法吸收类（pruner/inbox/EventV2 容错）是内核行为改造，嵌入对应流程（compaction/RunState/消费侧），默认生效，顶多留参数开关，不走能力包形态。

### 2.3 与三种插入形态的边界

| 形态 | 载体 | 适用 | 例子 |
|------|------|------|------|
| 能力包（本节） | Effect 独立包 + Layer 工厂 | B 类新能力（工具/后台服务） | session-query、schedule、subagent |
| 内核改造 | 直接嵌入现有流程 | A 类算法/语义吸收 | pruner、inbox、EventV2 容错 |
| cordis 插件 | 容器挂载（边缘线） | dsh 工具插件采用 | fs-search |

## 3. plugin 统一声明面（配置化）

### 3.1 一个声明面，三种路由

settings.json 的 `plugin` 字段是全部插件的唯一声明入口（opencode 上游已有，零新增配置面）。声明语法不变：`"name"` 或 `["name", { options }]`。装配按包导出形态自动识别路由：

```jsonc
{
  "plugin": [
    "existing-js-plugin",                        // 路由1：旧式 JS 插件 → 现有加载路径
    ["session-query", { "maxResults": 50 }],     // 路由2：能力包 → createLayer 工厂装配
    ["fs-search", { "engine": "ripgrep" }]       // 路由3：cordis 插件 → 容器装配（边缘线）
  ]
}
```

- **识别规则**：包导出含 `createLayer` → 能力包路由；包符合 cordis 插件协议 → 容器路由；否则 → 旧式插件加载。识别失败立即报错并指明声明的解析结果（misconfiguration fails loud）。
- **溯源与去重**：`plugin_origins` 机制对三种路由原样适用（global 声明 + space 声明合并，同名去重，空间覆盖全局）。
- **调试配套**：`--dump-config` 输出"声明 → 路由 → 物化结果 → 来源层级"装配树，对齐 dsh `--dump-config` 的调试体验。

### 3.2 配置化后置

配置化是装配机制，被装配物是能力包。机制形状应由被装配物反推——工厂签名、可配参数、装配时机等答案在第一个能力包插入时才暴露。因此配置化的启动条件：**能力包 ≥ 2 个，且第二次装配代码开始出现复制痛感**。在此之前，能力包用代码装配（装配层直接组合 Layer），参数用内置默认值。

此设计承接原 ConfigBridge 中经得起推敲的部分（声明式装配、fails loud、溯源、dump），剥掉容器专属部分（两级 context 路由、运行时动态装配、热重载）。两级配置（global/space）由 settings.json 的 mergeDeep 合并天然承载，与容器层级无关。

## 4. 权限收敛

### 4.1 事实基线（2026-08-19 全景侦察）

判定核心已接近目标简洁度：`Rule = {permission, pattern, action}` 三态（allow/deny/ask）+ wildcard 匹配 + last-wins 合并，与 dsh approval 语义同构且更细（pattern 级 vs 会话级）。纯判定核心约 900 行，`test/permission/next.test.ts` 1162 行测试护航。默认规则集（`*: allow` 兜底 + `.env` ask + question/repo_clone deny + doom_loop/external_directory ask）已是防误操作导向。

臃肿不在模型，在五处实现债：

| # | 问题 | 证据 |
|---|------|------|
| 1 | 双份实现并存 | core 包 `PermissionV2`（45 行纯函数）+ opencode 包 legacy 包装（312 行，含 tilde/$HOME 展开等 V2 缺失逻辑） |
| 2 | 两套合并语义 | config 层 `mergeDeep`（对象深合并）注入 Flag/环境，agent 层 `Permission.merge`（数组拼接）——同一配置两种语义 |
| 3 | ARITY 字典噪声 | LLM 生成 ~150 条命令前缀表，bash pattern 归一用，维护成本高，未命中退化为首 token |
| 4 | 渗透面广 | 63 文件 ~6900 行涉及（外围 TUI/SSE/HttpApi/ACP 透传 ~2700 行 + 工具 ask 调用点散布 17 个工具文件） |
| 5 | always 批准不持久化（bug） | `PermissionTable` schema 存在，但 always 只 push 内存 `approved` 数组，无回写路径——重启即丢 |

### 4.2 收敛设计

**目标：收敛而非重建。** 权限模型（三态 + ask 审批流 + once/always/reject）保持不变，对外契约（permission SSE 事件、HttpApi list/reply 端点、TUI 审批 UI）全部冻结。

1. **单一判定路径**：判定全部收敛到 `PermissionV2`；tilde/$HOME 展开等归一逻辑下沉 V2；legacy 薄包装（`permission/evaluate.ts` 转发文件、`index.ts` 包装函数）退役。
2. **单一合并语义**：配置注入路径（Flag/环境变量/CLI）与 ruleset 管道统一——配置层完成 `ConfigPermission.Info → Rule[]` 转换后，全程走 `Permission.merge` 数组语义，消除 mergeDeep 分叉。
3. **ARITY 缩编**：字典从 LLM 生成的 ~150 条缩为手工维护的核心命令表（≤ 30 条：git/npm/docker/bun/pnpm 等常用命令族），保留归一机制，未命中退化行为（首 token）不变。
4. **always 持久化修复**：always 批准回写 `PermissionTable`（per project，随 InstanceState 生命周期），重启后生效；这是 bug 修复，优先级最高。
5. **覆盖链显性化**：现状四层（defaults 硬编码 → user 配置 → agent 覆盖 → session 运行时）文档化并具名化为常量；global/space 两级由 settings mergeDeep 天然承载（现状即如此，写清楚即可）；行为以测试锁定。
6. **外围渗透不动**：TUI/SSE/HttpApi 是对外契约且只是透传，瘦它们没有收益。

### 4.3 明确不做

- 不用 dsh approval 替代（语义同构，替代等于换壳）
- 不做五段管道/guard 段（原 Step C 叙事，已撤销）
- 不做权限规则插件化（个人场景无第三方权限规则包需求；规则数据结构与执行引擎解耦即止）
- 不动审批交互流（ask 审批是真实需要的能力，瘦的是引擎不是交互）

## 5. 实施序列

每步只依赖前一步的产出，没有一步在为想象中的需求付费。

| 批次 | 内容 | 载体 | 依赖 | 备注 |
|------|------|------|------|------|
| Plan 2 | 权限收敛（§4.2 六项 + bug 修复） | Effect 原生 | 无 | 独立可做，测试护航 |
| Plan 3 | A 类机制吸收：tool-result-pruner → Inbox 两级队列 → EventV2 前向容错 | Effect 内核改造 | 无 | 可与 Plan 2 并行；研究报告 §11.4 排序 |
| Plan 4 | B 类首能力：session-query 4 工具 | 能力包（朴素装配） | 无 | 验证能力包工艺，为配置化暴露真实工厂签名 |
| Plan 5 | plugin 统一声明面（§3） | 装配层 | Plan 4 + 装配痛感显形 | 配置化后置论证见 §3.2 |
| Plan 6 | B 类批量：schedule 会话定时器等 | 能力包（声明装配） | Plan 5 | 插拔感到位 |
| 边缘线 | cordis 通道挂 fs-search 替换 grep/glob | cordis（边缘） | 无 | 随时独立启动，见 cordis 设计 §12.5 |
| 远期 | subagent 多后端、wopal_task 正规化、审计事件流 | 按需 | 需求驱动 | 单独立项 |

A 类与 B 类的依据与优先级论证见研究报告 §11（复刻研究）；其中 session-query 场景 ellamaka 的 SQLite 结构化存储相对 dsh 事件日志重放占优（§11.4 后发优势洞察）。

## 6. 与 cordis 的关系

本路线是主线，cordis 是边缘通道。能力包与 cordis 插件在 plugin 声明面（§3）是同构的一等公民，路由识别自动分流。cordis 的资产处置、使用条件、边缘线挂载方式见 `DESIGN-refactor-cordis.md` §12。两条线共享的工程纪律（TDD、验证隔离、既有测试零回归、cordis import 边界红线）不变。
