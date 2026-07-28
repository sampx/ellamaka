# Desktop Onboarding — 实现规范

> **状态**: Active
> **更新时间**: 2026-07-28
> **上级文档**:
> - `../../../docs/products/wopal-space/DESIGN-onboarding.md` — Onboarding 架构、Machine Capability 契约、通用约束
> - `./DESKTOP.md` — Desktop 架构与启动行为
> **Machine 契约**: `../../../projects/wopal-cli/src/lib/setup-machine.ts`（代码真相源）
> **Machine 实现**: `../../../projects/wopal-cli/src/lib/setup-operations.ts`

本文档定义 Desktop Onboarding 的**阶段化 UI 展现策略、步骤行为规范、导航契约与组件接口**。产品层架构约束与 Machine Capability 契约定义在上级文档 `DESIGN-onboarding.md`。

---

## 1. 核心设计理念

Onboarding 向导遵循三条原则：

1. **用户掌控推进**：步骤不会自动跳转。每个步骤完成后，系统展示检查结果，由用户点击"下一步"决定何时推进。用户也可以用"上一步"回看已完成的步骤，用"重试"重新执行当前步骤，用"停止"中止正在执行的长时间操作。
2. **进入即检查**：步骤进入后自动执行只读探测（probe）或预检查，向用户展示当前状态（已就绪 / 需要操作 / 已失败），降低"不知道该做什么"的认知负担。对于纯执行类步骤（如安装 CLI），进入后显示等待提示，用户点击导航栏的"下一步"触发执行。
3. **结果可见**：每个步骤执行完毕后，展示结构化的检查结果（版本、路径、状态、可用类型等），让用户确认后再推进。日志区实时显示执行过程的进度与诊断信息。

---

## 2. 阶段化展现策略（Phase Grouping）

### 2.1 设计原则

底层 `onboarding.json` 协议与 `wopal setup --machine` 的 10 步契约保持 **100% 不变**。UI 展现层将 10 步压缩为 **4 个直观阶段**，降低用户认知负荷。

```
阶段 1: 引擎准备        →  阶段 2: 能力与模型       →  阶段 3: 空间与记忆       →  阶段 4: 启动
(Step 1, 2, 3)           (Step 4+6 整合, Step 5)     (Step 7, 8, 9)              (Step 10+Done 合并)
```

### 2.2 阶段定义

| 阶段 | UI 标题 | 涵盖步骤 | 用户需要做的事 |
|:---:|---------|---------|---------------|
| 1 | 引擎准备 | `system-check` → `install-wopal-cli` → `install-ellamaka-cli` | 确认 `WOPAL_HOME`；CLI/引擎安装由用户点击"下一步"触发 |
| 2 | 能力与模型 | `ontology-setup`（整合 `github-auth`）、`ai-provider` | 选择 Ontology 模式（高级用户可填 Token）、填写 API Key |
| 3 | 空间与记忆 | `runtime-setup`、`create-space`、`memory-config` | 物化运行时能力、选择 Space 路径、可选配置记忆 |
| 4 | 启动 | `star-guide`（嵌入 done 页面）、`done` | 一键启动 Workbench |

### 2.3 阶段跟踪器

顶部进度条展示 **4 个阶段药丸按钮**。阶段遵循渐进解锁规则：

- 未解锁的阶段显示 `🔒`，不可点击。
- 已完成的阶段显示 `✓`，可点击回看。
- 当前阶段高亮。
- 用户只能跳转到已解锁的阶段首步。

### 2.4 步骤顺序

底层 `ONBOARDING_STEPS` 定义真实导航顺序，与阶段定义一致：

```
system-check → install-wopal-cli → install-ellamaka-cli → github-auth → ontology-setup → ai-provider → runtime-setup → create-space → memory-config → star-guide
```

`github-auth` 和 `star-guide` 在 UI 中不作为独立页面展示，分别整合进 `ontology-setup` 和 `done`。导航控制器在 `next()` 时自动跳过这两个步骤的独立页面。

### 2.5 GitHub Auth 整合到 Ontology 步骤

`github-auth`（Step 4）整合到 `ontology-setup`（Step 6）的交互流中：

- 默认选项"标准官方能力库"走 Clone 模式，无需 GitHub Token，跳过 Step 4。
- 高级选项"开发者自定义扩展"展开后，若用户选择 Fork 模式且未检测到 Token，则在当前页面内嵌 Token 输入区域。
- Token 输入 + Ontology 准备在同一页面依次完成，先执行 `github-auth` 再执行 `ontology-setup`。
- 底层 `onboarding.json` 中 `github-auth` 步骤仍正常记录状态（`done`/`skipped`），保持协议兼容。

### 2.6 Star Guide 合并到 Done 页面

`star-guide`（Step 10）嵌入到 Done 完成页面的社区支持卡片中：

- Done 页面展示社区支持卡片：Star 按钮 + 文档链接 + 社区入口。
- 有 GitHub Token 时提供"一键 Star"按钮。
- 无 Token 时提供"浏览器打开仓库页"链接。
- Star 操作不阻塞"启动 Workbench"按钮。
- 底层 `onboarding.json` 中 `star-guide` 步骤仍正常记录状态。

---

## 3. 导航契约

### 3.1 固定底部导航栏

每个步骤卡片底部固定显示导航栏，包含三个按钮，状态由当前步骤的执行状态驱动：

| 按钮 | 显示条件 | 禁用条件 | 行为 |
|------|---------|---------|------|
| **上一步** | 始终显示（除第一步外） | 正在执行中 | 回到上一个步骤，重置步骤状态 |
| **停止** | 正在执行中 | — | 中止当前操作（通过 `AbortController`） |
| **重试** | 步骤执行失败 | 正在执行中 | 重新触发当前步骤的 form submit |
| **跳过本步骤** | 当前步骤为可选步骤且未成功 | 正在执行中或已成功 | 调用 `executeStep(skip: true)` 并推进 |
| **下一步** | 当前步骤非自动推进且非 done | 正在执行中 | 未成功时触发 `form.requestSubmit()`；已成功时直接推进到下一步 |

### 3.2 按钮文案

"下一步"按钮的文案根据步骤类型和状态动态变化：

- 未执行时：显示步骤特定的动作文案（如"开始检查"、"安装 Wopal CLI"、"准备能力库"、"保存配置"、"创建工作空间"）。
- 已成功时：显示"下一步"。
- `done` 步骤：不显示"下一步"（启动按钮在卡片内部）。

### 3.3 步骤状态驱动

导航栏按钮的启用/禁用由 root 组件的三个信号驱动：

- `working`：步骤正在执行中（`onStatusChange("working")`）。
- `stepResult`：步骤执行结果（`null` = 未执行，`{success: true}` = 成功，`{success: false}` = 失败）。
- `errorInfo`：步骤错误信息。

步骤组件通过 `onStatusChange` 和 `onError` 回调更新这些信号，不直接调 `onComplete` 推进——推进完全由用户点击"下一步"触发。

### 3.4 取消支持

正在执行的步骤可以通过"停止"按钮中止。IPC 层为每个步骤创建 `AbortController`，`onboarding-cancel-step` channel 触发 `abort()`，子进程被 kill，步骤返回 `ABORTED` 状态。前端重置为可重试状态。

---

## 4. 步骤行为规范

> 每个步骤分三层描述：**目标**（用户价值）、**行为规则**（系统约束）、**UI 展现**（进入时、执行中、完成后的界面状态）。

### 4.1 system-check（阶段 1，不可跳过）

**目标**：向用户确认/选择 `WOPAL_HOME` 工作目录，并确认系统满足最低运行条件。

**行为规则**：
- 进入时从 `process.env.WOPAL_HOME` 或 `~/.wopal` 获取初始路径，填入目录输入框。
- 用户可修改路径，修改后 300ms 防抖更新 `process.env.WOPAL_HOME`。
- 用户点击"下一步"（文案"开始检查"）触发 `system-check` 执行，检查：Git CLI 可用、`WOPAL_HOME` 可写、网络可达发布 CDN、磁盘 > 500MB。
- 检查通过后展示系统信息（平台、架构、Node 版本、Git 版本、网络状态）。
- 在 `done` 步骤完成时，将 `WOPAL_HOME` 写入用户持久化环境变量（跨平台兼容）。

**UI 展现**：
- 进入时：显示 `WOPAL_HOME` 目录输入框 + "更改目录"按钮。
- 执行中：显示进度指示"正在检查系统环境与目录可写性…"。
- 完成后：显示"✓ 系统环境与目录可写性检查通过"。

### 4.2 install-wopal-cli（阶段 1，不可跳过）

**目标**：确保 CLI 二进制存在且可执行。

**行为规则**：
- 进入时不自动执行，显示等待提示。
- 用户点击"下一步"（文案"安装 Wopal CLI"）触发下载并执行 `install.sh` 安装脚本。
- 已存在二进制：验证可执行并检测新版本，返回 `reused`。
- 缺失或有新版本：下载并执行安装，返回 `completed`。
- 不通过 machine capability（CLI 可能尚未就绪）。
- 支持取消（`AbortController` kill 子进程）。

**UI 展现**：
- 进入时：显示"点击「安装 Wopal CLI」开始"。
- 执行中：进度显示"检查 Wopal CLI 版本…"，日志区实时显示安装脚本输出。
- 完成后：显示版本号、最新版本、二进制路径。

### 4.3 install-ellamaka-cli（阶段 1，不可跳过）

**目标**：确保引擎二进制存在且可执行。

**行为规则**：
- 进入时不自动执行，显示等待提示。
- 用户点击"下一步"（文案"安装 Ellamaka"）触发 machine `install-engine`。
- 已安装且未强制 → `reused`；缺失或强制 → `created`。
- 支持取消。

**UI 展现**：
- 进入时：显示"点击「安装 Ellamaka」开始"。
- 执行中：进度显示"正在安装 Ellamaka 引擎…"，日志区实时显示引擎下载/解压进度。
- 完成后：显示版本号、Channel、二进制路径。

### 4.4 ontology-setup + github-auth（阶段 2 首步，不可跳过）

**目标**：准备 ontology 本地仓库（含可选的 GitHub Token 配置）。

**行为规则**：
- 进入时 probe GitHub 认证状态与 ontology 已有配置。
- 默认模式"标准官方能力库"走 Clone 模式，无需 Token。
- 高级模式展开后选择 Fork：无 Token 时内嵌 Token 输入区域，提交后先执行 `github-auth` 再执行 `ontology-setup`；已有 Token 时直接执行。
- form id 必须为 `onboarding-step-ontology-setup`（与 `currentStep` 匹配，否则导航栏的 `requestSubmit` 会找不到 form）。

**UI 展现**：
- 进入时：显示来源选择（官方/自定义）、存储方式（Clone/Fork）对比卡片。
- 执行中：进度显示"正在准备能力模板库…"。
- 完成后：显示来源、方式、存储位置、可用类型数量。

### 4.5 ai-provider（阶段 2 第二步，可跳过）

**目标**：配置 OpenCode Go AI 提供商 API Key。

**行为规则**：
- 进入时检测已配置 key，命中则预填展示。
- 仅当提供 key 时调用 machine `configure-provider`（`providerId: "opencode"`）。
- 暂时仅支持 OpenCode Go。
- 跳过按钮文案"跳过本步骤"。

**UI 展现**：
- 进入时：显示套餐信息 + "前往注册并订阅"按钮 + API Key 输入框。
- 完成后：显示套餐名称、API Key 可用状态。

### 4.6 runtime-setup（阶段 3，不可跳过）

**目标**：把 ontology 运行时配置与能力物化到 `$WOPAL_HOME`。

**行为规则**：
- 进入时不自动执行，显示等待提示。
- 用户点击"下一步"（文案"配置运行时"）触发执行流程：先 probe runtime 状态，再调 `prepare-runtime`，最后复检。
- 如果 ontology 未准备，显示友好错误"能力模板库尚未准备，请先完成「能力与模型」阶段"。
- 支持取消。

**UI 展现**：
- 进入时：显示"点击「配置运行时」开始"。
- 执行中：进度显示当前阶段（检查 / 物化 / 复检）。
- 完成后：显示"✓ 运行时已就绪"。

### 4.7 create-space（阶段 3，不可跳过）

**目标**：创建或复用工作空间。

**行为规则**：
- 进入时 probe 环境与已注册空间列表。
- 已存在空间：显示已有空间列表 + "跳过创建（复用已有）"按钮（组件内部跳过逻辑，不走 root 的可选步骤跳过）。
- 全新环境：不提供跳过，用户指定目录路径与能力类型。
- 调用 machine `initialize-space` 时必填 `path`，默认 `~/WopalSpace`，类型 `common`。

**UI 展现**：
- 进入时：显示已有空间列表（如有）+ 目录选择器 + 类型下拉框。
- 完成后：显示空间名称、路径、类型、创建/复用状态。

### 4.8 memory-config（阶段 3 第三步，可跳过）

**目标**：配置长期记忆系统。

**行为规则**：
- 进入时 probe 已有配置。
- 调用 machine `configure-memory`，`enabled` 必填。
- 跳过 = `enabled: false`，已有凭证保留。

**UI 展现**：
- 进入时：显示启用开关（默认关闭）+ 简化表单（启用后展开）。
- 完成后：显示启用状态、作用域、endpoint/model、密钥状态、env path。

### 4.9 done + star-guide（阶段 4）

**目标**：确认就绪并引导进入 Workbench。

**行为规则**：
- 进入时自动静默执行 `star-guide`（有 Token 自动 Star，无 Token 跳过）。
- 用户点击卡片内的"🚀 启动工作台"按钮触发流程：先调 `onboardingComplete`（machine `inspect` 门禁，`verdict === "healthy"` 才允许），再 `onboardingTransitionToWorkbench`。
- 底部导航栏对 `done` 步骤只显示"上一步"，不显示"下一步"。

**UI 展现**：
- 居中展示"🎉 设置完成！"与配置摘要。
- 社区支持卡片（Star 按钮）。
- "🚀 启动工作台"主按钮。
- 非致命警告以可折叠列表展示。

---

## 5. 错误处理矩阵

每个 machine operation 可能的失败模式及 Desktop 应如何响应。

### 5.1 install-engine（步骤 3）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| 网络不可达 | R2 域名 DNS 解析失败 / 连接超时 | `ok: false` | 展示"网络连接失败，请检查网络后重试" + 重试按钮 |
| 下载超时 | 文件过大或网络过慢（300s 超时） | `ok: false` | 展示"下载超时，请检查网络后重试" + 重试按钮 |
| SHA-256 校验失败 | 文件损坏或被篡改 | `ok: false` | 展示"文件校验失败，请重试" + 重试按钮 |
| 磁盘空间不足 | 写入 binary 时磁盘满 | `ok: false` | 展示"磁盘空间不足（需 >500MB），请清理后重试" + 重试按钮 |
| 用户取消 | 点击"停止"按钮 | `INSTALLATION_ABORTED` | 重置为可重试状态，不显示错误 |

### 5.2 configure-github（步骤 4）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| token 格式无效 | token 为空或不符合 GitHub PAT 格式 | `ok: false` | 展示"Token 格式无效，请输入有效的 GitHub Personal Access Token" |
| 文件写入失败 | 无写权限或磁盘满 | `ok: false` | 展示"配置保存失败，请检查磁盘空间和权限后重试" + 重试按钮 |
| 用户跳过 | 使用默认 Clone 模式（不填 Token） | 不调用 machine | 标记步骤为 `skipped`，继续 Ontology 准备 |

### 5.3 configure-provider（步骤 5）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| providerId 未知 | 传入不支持的 provider | `ok: false` | 展示"不支持的 AI Provider" + 不提供重试 |
| apiKey 为空 | 用户未填写 API Key | Desktop 本地校验 | 提示"请输入 API Key" |
| 文件写入失败 | 无写权限或磁盘满 | `ok: false` | 展示"配置保存失败，请检查磁盘空间和权限后重试" + 重试按钮 |
| 用户跳过 | 点击"跳过本步骤" | 不调用 machine | 标记步骤为 `skipped`，进入阶段 3 |

### 5.4 prepare-ontology（步骤 6）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| GitHub 认证缺失 | 用户选择 Fork，但没有可用 token | `ok: false` | 在 Ontology 页面内展示 Token 输入区域 |
| 已有模式冲突 | 已安装 ontology 的拓扑与用户选择不同 | `ok: false` | 展示当前拓扑并允许按当前模式重试 |
| 网络或 Git 失败 | clone/fork/fetch 失败 | `ok: false` | 保留当前页面，展示诊断信息与重试按钮 |
| 用户取消 | 点击"停止"按钮 | `ABORTED` | 重置为可重试状态 |

### 5.5 prepare-runtime（步骤 7）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| ontology 未准备 | 步骤 6 尚未成功 | `SETUP_ONTOLOGY_NOT_PREPARED` | 展示"能力模板库尚未准备，请先完成「能力与模型」阶段" |
| settings 写入失败 | ontology 配置缺失或目标不可写 | `SETUP_RUNTIME_PREPARE_FAILED` | 停留，展示诊断与重试按钮 |
| 能力物化失败 | agents/skills/commands 等源缺失 | `SETUP_RUNTIME_PREPARE_FAILED` | 停留，展示失败能力与重试按钮 |
| 用户取消 | 点击"停止"按钮 | `ABORTED` | 重置为可重试状态 |

### 5.6 initialize-space（步骤 8）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| ontology 未准备 | 步骤 6 尚未成功 | `ok: false` | 展示"Ontology 尚未准备，请先完成上一步" |
| 磁盘空间不足 | worktree 创建失败 | `ok: false` | 展示"磁盘空间不足" + 重试按钮 |
| worktree 冲突 | space 名已存在 | `ok: false` | 展示"空间名称已被使用" |
| 路径无效 | path 不存在或不可写 | `ok: false` | 展示"所选目录无效或不可写" |

### 5.7 configure-memory（步骤 9）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| 配置不完整 | 启用记忆但缺少必要字段 | `SETUP_MEMORY_CONFIG_INCOMPLETE` | 保留当前页面，展示缺失字段 |
| 文件写入失败 | 无写权限或磁盘满 | `ok: false` | 展示"配置保存失败" + 重试按钮 |
| 用户跳过 | 点击"跳过本步骤" | `enabled: false` | 标记步骤为 `skipped`，已有凭证保留 |

---

## 6. Renderer 组件接口契约

### 6.1 步骤组件通用 Props

所有步骤组件共享基础接口：

```typescript
interface StepProps {
  onComplete: () => void;                                    // 步骤成功完成（推进由 root 导航栏触发）
  onError: (err: string | { code?: string; message: string; details?: string } | null) => void;
  onStatusChange?: (status: "working" | "success" | "error") => void;
}
```

步骤组件**不直接调 `onComplete` 推进**。推进由 root 组件的 `handleNextClick` 在用户点击"下一步"时触发。步骤组件只通过 `onStatusChange` 和 `onError` 上报状态。

### 6.2 Root 组件状态

```typescript
// Root 组件持有以下信号，驱动导航栏按钮状态：
currentStep: Signal<OnboardingStepName | "done">  // 当前步骤
working: Signal<boolean>                          // 正在执行中
stepResult: Signal<{ success: boolean } | null>   // 步骤执行结果
errorInfo: Signal<{ code?: string; message: string; details?: string } | null>
maxUnlockedPhase: Signal<number>                   // 最大已解锁阶段
hasExistingSpaces: Signal<boolean>                 // 是否有已有空间
```

### 6.3 导航控制器

```typescript
interface StepController {
  getCurrentStep(): OnboardingStepName | "done"
  setCurrentStep(step): void
  next(): void      // 按 ONBOARDING_STEPS 顺序推进，跳过 github-auth 和 star-guide 独立页面
  prev(): void      // 回退，同样跳过 github-auth 和 star-guide
}
```

### 6.4 阶段配置

```typescript
interface PhaseConfig {
  phase: 1 | 2 | 3 | 4
  title: string
  steps: (OnboardingStepName | "done")[]
}
```

`PHASE_CONFIGS` 定义 4 个阶段，与 `ONBOARDING_STEPS` 顺序一致。

---

## 7. IPC Handler 接口

### 7.1 IPC Channel 清单

| Channel | 方向 | 用途 |
|---------|------|------|
| `get-onboarding-mode` | Renderer → Main | 解析 onboarding vs workbench 模式 |
| `onboarding-get-state` | Renderer → Main | 读取 onboarding.json |
| `onboarding-execute-step` | Renderer → Main | 执行一个步骤（调 machine 或本地操作），创建 AbortController |
| `onboarding-cancel-step` | Renderer → Main | 取消当前正在执行的步骤 |
| `onboarding-probe` | Renderer → Main | 只读探测（github-auth / ai-provider / runtime / environment / memory），不改变步骤状态 |
| `onboarding-complete` | Renderer → Main | 完成门禁检查，写入 completed 状态 |
| `onboarding-set-wopal-home` | Renderer → Main | 更新 WOPAL_HOME 路径 |
| `onboarding-transition-to-workbench` | Renderer → Main | 进程内转换进入 Workbench |
| `onboarding-progress` | Main → Renderer | 推送步骤执行进度（broadcastProgress） |

### 7.2 执行与取消

`onboarding-execute-step` 每次执行时创建 `AbortController`，传递 `abortSignal` 给底层 `installWopalCli` 和 `runSetupOperation`。`onboarding-cancel-step` 触发 `abort()`，子进程被 kill，步骤返回 `ABORTED` 错误码。

### 7.3 进度转发

`runSetupOperation` 同时转发 stdout 和 stderr 的非 JSON 行到 `onProgress`，使 engine 安装等操作的进度可见。JSON envelope 行（以 `{` 或 `}` 开头）不转发，保留用于最终结果解析。

### 7.4 Handler 注册保护

`registerIpcHandlers` 注册前先 `ipcMain.removeHandler` 清理所有 onboarding channel，防止 dev HMR 重载时重复注册报错。

---

## 8. 日志

### 8.1 持久化日志

IPC 层通过 `getOnboardingLogger` 写入 `$WOPAL_HOME/logs/onboarding.log`，记录步骤执行、成功、失败、诊断信息。日志超过 1MB 时轮转为 `onboarding.log.1`。

### 8.2 UI 日志区

Renderer 底部显示可折叠的日志抽屉，实时显示 IPC `onboarding-progress` 通道推送的进度消息和错误信息。日志区自动滚动到底部，保留最近 200 条。

---

## 9. 相关文档

| 文档 | 说明 |
|------|------|
| `../../../docs/products/wopal-space/DESIGN-onboarding.md` | Onboarding 架构、步骤序列、Machine Capability 契约、通用约束 |
| `./DESKTOP.md` | Desktop 系统架构、启动行为 |
| `./DISTRIBUTION.md` | ellamaka 分发 |
| `../../../projects/wopal-cli/src/lib/setup-machine.ts` | Machine operation 精确类型定义 |
| `../../../projects/wopal-cli/src/lib/setup-operations.ts` | Machine operation 实现 |