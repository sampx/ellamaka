# Desktop Onboarding — 实现规范

> **状态**: Active
> **更新时间**: 2026-07-26
> **上级文档**:
> - `../../../docs/products/wopal-space/DESIGN-onboarding.md` — Onboarding 架构、步骤行为、通用约束
> - `./DESKTOP.md` — Desktop 架构与启动行为
> **Machine 契约**: `../../../projects/wopal-cli/src/lib/setup-machine.ts`（代码真相源）
> **Machine 实现**: `../../../projects/wopal-cli/src/lib/setup-operations.ts`

本文档补充产品层 `DESIGN-onboarding.md`，提供 Desktop 实现所需的错误处理矩阵与 renderer 组件接口契约。

---

## 1. 错误处理矩阵

每个 machine operation 可能的失败模式及 Desktop 应如何响应。

### 1.1 install-engine（步骤 3）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| 网络不可达 | R2 域名 DNS 解析失败 / 连接超时 | `ok: false` | 展示"网络连接失败，请检查网络后重试" + 重试按钮 |
| 下载超时 | 文件过大或网络过慢（300s 超时） | `ok: false` | 展示"下载超时，请检查网络后重试" + 重试按钮 |
| SHA-256 校验失败 | 文件损坏或被篡改 | `ok: false` | 展示"文件校验失败，请重试" + 重试按钮（不要提示用户手动下载） |
| 磁盘空间不足 | 写入 binary 时磁盘满 | `ok: false` | 展示"磁盘空间不足（需 >500MB），请清理后重试" + 重试按钮 |
| `ellamaka --version` 不匹配 | 下载的 binary 版本不符 | `ok: false` | 展示"安装验证失败，引擎版本不匹配" + 重试按钮 |
| CLI 未安装 | Desktop 未完成步骤 2 就执行步骤 3 | N/A（Desktop 应在步骤 2 失败时不进入步骤 3） | 不应出现此状态。步骤 2 失败时阻塞后续步骤 |

### 1.2 configure-github（步骤 4）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| token 格式无效 | token 为空或不符合 GitHub PAT 格式 | `ok: false` | 展示"Token 格式无效，请输入有效的 GitHub Personal Access Token" |
| 文件写入失败 | 无写权限或磁盘满 | `ok: false` | 展示"配置保存失败，请检查磁盘空间和权限后重试" + 重试按钮 |
| 用户跳过 | 点击"跳过"（步骤 4 可选） | 不调用 machine | 标记步骤为 `skipped`，进入步骤 5 |

### 1.3 configure-provider（步骤 5）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| providerId 未知 | 传入不支持的 provider | `ok: false` | 展示"不支持的 AI Provider" + 不提供重试（返回选择 provider 界面） |
| apiKey 为空 | 用户未填写 API Key | Desktop 不应发送请求（本地校验） | 提示"请输入 API Key"（红色输入框边框） |
| 文件写入失败 | 无写权限或磁盘满 | `ok: false` | 展示"配置保存失败，请检查磁盘空间和权限后重试" + 重试按钮 |
| 用户跳过 | 点击"跳过"（步骤 5 可选） | 不调用 machine | 标记步骤为 `skipped`，进入步骤 6 |
| checkOnly 检测 | Desktop 本地探测已有 provider（不调 machine） | N/A | 本地读 auth.json，已有配置则预填 providerId 并展示"检测到已有配置"提示 |

### 1.4 prepare-ontology（步骤 6）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| GitHub 认证缺失 | 用户选择 Fork，但没有可用 token/gh 认证 | `ok: false` | 展示认证前提和返回步骤 4 的入口，保留 Clone 选项 |
| 已有模式冲突 | 已安装 ontology 的实际拓扑与用户选择不同 | `ok: false` | 展示当前拓扑并允许按当前模式重试 |
| 网络或 Git 失败 | clone/fork/fetch 失败 | `ok: false` | 保留步骤 6，展示诊断信息与重试按钮 |
| 类型分支物化失败 | 远端 `type/*` 未完整落为本地分支 | `ok: false` | 保留步骤 6，不允许进入 Space 类型选择 |
| 成功 | 本地 `main` 与全部 `type/*` 已准备 | `created` / `reused` | 展示本体路径与类型数量，用户主动继续 |

### 1.5 prepare-runtime（步骤 7）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| ontology 未准备 | 步骤 6 尚未成功 | `SETUP_ONTOLOGY_NOT_PREPARED` | 返回步骤 6，完成 ontology 准备后重试 |
| settings 写入失败 | ontology 配置缺失、目标不可写或磁盘满 | `SETUP_RUNTIME_PREPARE_FAILED` | 保留步骤 7，展示 settings 诊断与重试按钮 |
| scripts 同步失败 | ontology scripts 缺失或链接/复制失败 | `SETUP_RUNTIME_PREPARE_FAILED` | 保留步骤 7，展示缺失脚本与重试按钮 |
| 能力物化失败 | agents/skills/commands/rules/plugins/prompts 任一源缺失或目标不可写 | `SETUP_RUNTIME_PREPARE_FAILED` | 保留步骤 7，展示失败能力与重试按钮 |
| 成功 | 三类全局运行时动作全部 ready | `created` / `reused` | 展示 settings、scripts、能力摘要，用户主动继续 |

### 1.6 initialize-space（步骤 8）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| ontology 未准备 | 步骤 6 尚未成功 | `ok: false` | 展示"Ontology 尚未准备，请先完成上一步"，返回步骤 6 |
| 磁盘空间不足 | worktree 创建失败 | `ok: false` | 展示"磁盘空间不足（需 >500MB），请清理后重试" + 重试按钮 |
| worktree 冲突 | space 名已存在 | `ok: false` | 展示"空间名称已被使用，请更换名称" + 回到命名界面 |
| type 分支不存在 | 指定本地 type ref 未找到 | `ok: false` | 展示"所选类型分支未准备完成"并留在类型选择界面 |
| 路径无效 | path 不存在或不可写 | `ok: false` | 展示"所选目录无效或不可写，请选择其他目录" + 回到路径选择界面 |
| 已有 Space | 路径已包含可恢复 Space 或已注册 | `reused` | 展示关联/复用结果并进入步骤 9 |
| 用户跳过 | 环境已有至少一个注册 Space | Desktop 明确写入 `skipped` | 进入步骤 9；全新环境不展示跳过入口 |

### 1.7 configure-memory（步骤 9）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| 文件写入失败 | 无写权限或磁盘满 | `ok: false` | 展示"配置保存失败，请检查磁盘空间和权限后重试" + 重试按钮 |
| enabled 未传 | Desktop 漏传必填字段 `enabled` | `ok: false` | 实现层错误——Desktop 的 `onboardingExecuteStep` 必须确保 `enabled: true/false` |
| 用户跳过 | 点击"跳过"或只勾选 `enabled` | 仅传 `{ enabled: true }`（不传可选 LLM/Embedding 字段） | 标记步骤为 `skipped`，进入步骤 10 |

### 1.8 star（步骤 10）

| 错误类型 | 原因 | machine 返回 | Desktop 响应 |
|---------|------|-------------|-------------|
| API rate limit | GitHub API 频率限制 | `ok: false` | 不阻塞进入 done。在 done 页面以提示形式展示"Star 操作暂时不可用（API 限流），可稍后在仓库页面手动 Star" |
| 网络不可达 | GitHub API 不可达 | `ok: false` | 同上，非阻塞 |
| 用户跳过 | 点击"跳过"、`accepted: false` 或无 token 无 fallback | `skipped` / `skipped-no-github` | 标记为 `skipped`，正常进入 done |
| 浏览器无法打开 | `browserFallback` 启用但 `shell.openExternal` 失败 | `skipped` | 展示"无法打开浏览器，请手动访问仓库页面" + 展示仓库 URL |

---

## 2. Renderer 组件接口契约

### 2.1 通用 Step 组件 Props

所有步骤组件共享的基础接口：

```typescript
interface StepProps {
  currentStep: number;           // 当前步骤索引 (1-based)
  totalSteps: number;            // 总步骤数
  state: OnboardingState;        // 当前 onboarding 状态
  onComplete: (result: StepResult) => void;   // 步骤成功完成
  onError: (error: StepError) => void;         // 步骤失败
  onSkip: () => void;                          // 用户主动跳过
}
```

### 2.2 StepResult（通用）

```typescript
interface StepResult {
  stepId: string;                // 步骤标识（如 "system-check"）
  input: Record<string, unknown>; // 步骤收集的用户输入（传给 machine 或记录）
}
```

### 2.3 StepError（通用）

```typescript
interface StepError {
  stepId: string;
  code: string;                  // 错误码，对应 §1 表格中的错误类型
  message: string;               // 用户可读的错误信息
  details?: string;              // 技术细节（可选，用于日志，不展示给用户）
  retryable: boolean;            // 用户是否可以重试
}
```

### 2.4 system-check（步骤 1，无 machine 调用）

```typescript
interface SystemCheckProps extends StepProps {
  // 无额外 props。
  // 组件本地执行：git 版本检查、WOPAL_HOME 可写性、磁盘空间 (>500MB)、网络连通性。
  // 完成后直接调用 onComplete({ stepId: "system-check", input: {} })。
}
```

### 2.5 install-wopal-cli（步骤 2，无 machine 调用）

```typescript
interface InstallWopalCliProps extends StepProps {
  // 无额外 props。
  // Desktop 自行下载安装 wopal-cli binary 到 $WOPAL_HOME/bin/wopal。
  // 进度展示：下载百分比 + 解压中 + 验证中。
  // 完成后调用 onComplete({ stepId: "install-wopal-cli", input: { cliPath: "<path>" } })。
}
```

### 2.6 install-ellamaka-cli（步骤 3）

```typescript
interface InstallEllamakaCliProps extends StepProps {
  // 无额外用户输入字段。machine 自动处理。
  // 进度展示：下载百分比 + 校验中 + 安装中 + 验证中。
  // 完成后调用 onComplete({ stepId: "install-ellamaka-cli",
  //   input: { version: "<ver>", binaryPath: "<path>" } })。
}
```

### 2.7 github-auth（步骤 4，可选）

```typescript
interface GithubAuthProps extends StepProps {
  // 组件内部状态：
  // - token: string        用户输入的 GitHub PAT
  // - valid: boolean       格式校验结果
  // - detected: boolean    是否检测到已有 token（从 env 读取）
  // - showSkip: true       此步骤可跳过
  //
  // 完成后调用 onComplete({ stepId: "github-auth", input: { token: "<token>" } })。
}
```

### 2.8 ai-provider（步骤 5，可选）

```typescript
interface AiProviderProps extends StepProps {
  // 组件内部状态：
  // - providerId: string   用户选择的 provider（如 "openai"、"anthropic"）
  // - apiKey: string        用户输入的 API Key
  // - detected: boolean    是否检测到已有配置（从 auth.json 读取）
  // - showSkip: true       此步骤可跳过
  //
  // 完成后调用 onComplete({ stepId: "ai-provider",
  //   input: { providerId: "<id>", apiKey: "<key>" } })。
}
```

### 2.9 ontology-setup（步骤 6）

```typescript
interface OntologySetupProps extends StepProps {
  // 组件内部状态：
  // - mode: "fork" | "clone"
  // - hasGithubAuth: boolean
  // - existingMode: "fork" | "clone" | null
  //
  // 有有效 GitHub 认证且无既有本体时默认 Fork，否则默认 Clone。
  // 用户只选择本体模式。成功提交：
  // onComplete({ stepId: "ontology-setup", input: { mode } })。
  // machine result 中 availableTypes 仅展示准备结果，类型选择由步骤 8 所有。
}
```

### 2.10 runtime-setup（步骤 7）

```typescript
interface RuntimeSetupProps extends StepProps {
  // 无用户输入。调用 machine prepare-runtime。
  // 展示 settingsPath、scripts 同步数量与六类基础能力状态。
  // 三类动作全部 ready 后调用 onComplete。
}
```

### 2.11 create-space（步骤 8）

```typescript
interface CreateSpaceProps extends StepProps {
  // 组件内部状态：
  // - spacePath: string      空间路径（可编辑的目录路径）
  // - type: string           选择的类型（如 "common"、"coding"）
  // - availableTypes: Array<{ type: string, branch: string }>
  // - existingSpaces: Array<{ name: string, path: string, type: string | null }>
  //
  // 步骤开始时通过只读 probe 调用 machine `inspect`。
  // availableTypes 来自步骤 6 已准备的本地 ontology 分支。
  // 选择已有 Space 会填入其路径和锁定类型；全新路径执行创建。
  // 环境已有注册 Space 时可明确跳过创建。
  // 完成后调用 onComplete({ stepId: "create-space",
  //   input: { path, type } })。
}
```

### 2.12 memory-config（步骤 9，可选）

```typescript
interface MemoryConfigProps extends StepProps {
  // 组件内部状态：
  // - enabled: boolean              是否启用记忆
  // - llmEndpoint: string           自定义 LLM 端点（enabled=true 时可选）
  // - llmKey: string                自定义 LLM Key（enabled=true 时可选）
  // - llmModel: string              自定义 LLM Model（enabled=true 时可选）
  // - embeddingEndpoint: string     自定义 Embedding 端点（enabled=true 时可选）
  // - embeddingKey: string          自定义 Embedding Key（enabled=true 时可选）
  // - embeddingModel: string        自定义 Embedding Model（enabled=true 时可选）
  // - showAdvanced: boolean         是否展开高级配置
  // - showSkip: true                此步骤可跳过
  //
  // 默认只展示 enabled checkbox。enabled=true 时展开高级选项。
  // 完成后调用 onComplete({ stepId: "memory-config",
  //   input: { enabled, ...optionalLLMFields } })。
}
```

### 2.13 star-guide（步骤 10，可选）

```typescript
interface StarGuideProps extends StepProps {
  // 组件内部状态：
  // - showSkip: true             此步骤可跳过
  //
  // accepted: true 时触发 machine `star`。
  // 完成后调用 onComplete({ stepId: "star-guide",
  //   input: { accepted: boolean } })。
}
```

### 2.14 done（终态，非步骤组件）

```typescript
interface DoneViewProps {
  state: OnboardingState;         // 完整的 onboarding 状态
  nonFatalFailures: StepError[];  // 非致命步骤的失败信息（须展示给用户）
  onRelaunch: () => void;         // 触发 relaunch
}
```

`onboardingComplete()` 在写入完成态前调用 machine `inspect`。只有 `verdict === "healthy"` 才允许 relaunch。门禁失败返回结构化错误，Renderer 保留在 done 页面并展示缺失维度。

---

## 3. IPC Handler 接口

### 3.1 OnboardingIpcHandlers 依赖

```typescript
interface OnboardingIpcDeps {
  getWopalHome: () => string;                    // 解析 WOPAL_HOME
  executeMachineOperation: (op: MachineOperation) => Promise<MachineResponse>;  // 调用 wopal setup --machine
  readOnboardingState: () => OnboardingState;    // 读 onboarding.json
  writeOnboardingState: (state: Partial<OnboardingState>) => void;  // 写 onboarding.json（原子替换）
  broadcastProgress: (stepId: string, status: StepStatus) => void;  // 通知 renderer 进度
  relaunchApp: () => void;                       // 重启应用
  downloadFile: (url: string, dest: string) => Promise<boolean>;  // 下载 CLI binary
  checkSystem: () => SystemCheckResult;          // 本地系统检查
}
```

步骤执行与只读探测使用独立通道。`onboarding:execute-step` 是唯一推动步骤状态的入口。认证检测、provider 检测和 machine `inspect` 走 `onboarding:probe`，不写 `in-progress`、`done` 或 `currentStep`。

Machine client 将 capability success envelope 的 `data` 解释为 `SetupOperationResult`。`created`、`reused`、`skipped` 分别映射为 Renderer 的 `completed`、`reused`、`skipped`，业务结果取自 `data.result`。这一适配保证 UI 读取扁平业务字段，并保留用户跳过与真实复用语义。

### 3.2 IPC Channel 清单

| Channel | 方向 | 用途 |
|---------|------|------|
| `onboarding:read-state` | Renderer → Main | 读取当前 onboarding.json |
| `onboarding:execute-step` | Renderer → Main | 执行一个步骤（调 machine 或本地操作） |
| `onboarding:probe` | Renderer → Main | 只读探测 GitHub、Provider 或 setup 环境，不改变步骤状态 |
| `onboarding:progress` | Main → Renderer | 推送步骤执行进度（broadcastProgress） |
| `onboarding:relaunch` | Renderer → Main | 完成 onboarding 后重启 |
| `onboarding:get-system-info` | Renderer → Main | 获取系统信息（步骤 1） |

---

## 4. 相关文档

| 文档 | 说明 |
|------|------|
| `../../../docs/products/wopal-space/DESIGN-onboarding.md` | Onboarding 架构、步骤行为规范、通用约束 |
| `./DESKTOP.md` | Desktop 系统架构、启动行为 |
| `./DISTRIBUTION.md` | ellamaka 分发 |
| `../../../projects/wopal-cli/src/lib/setup-machine.ts` | Machine operation 精确类型定义 |
| `../../../projects/wopal-cli/src/lib/setup-operations.ts` | Machine operation 实现 |
