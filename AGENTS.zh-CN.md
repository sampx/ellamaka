---
name: Ellamaka AGENT RULES
description: WopalSpace engine fork of OpenCode for running space-aware agents, commands, plugins, configuration, and TUI behavior
---

# Agent Development Rules

## 1. Canonical References

- DESIGN: `docs/DESIGN.md`
- API CONTRACT: `docs/API-CONTRACT.md`
- BRANDING: `docs/BRANDING.md`
- WORKBENCH: `docs/WORKBENCH.md`
- DESKTOP: `docs/DESKTOP.md`
- DISTRIBUTION: `docs/DISTRIBUTION.md`
- Upstream Merge logs: `docs/UPSTREAM-MERGE-LOG.md`
- Config Reference: `docs/references/ellamaka-config-mechanism.md`
- `.gitattributes` — fork 独有文件的 merge 保护规则（`merge=ours`）
- opencode package rules: `packages/opencode/AGENTS.md`
- ellamaka-app package rules: `packages/ellamaka-app/AGENTS.md`
- desktop package rules: `packages/ellamaka-desktop/AGENTS.md`

## 2. Architecture and Directories

执行链：OpenCode upstream → ellamaka fork → `--wopal-space` → `.wopal/` ontology → `.wopal-space/` runtime。

| 目录 | 职责 |
|---|---|
| `packages/opencode/` | OpenCode inherited engine 主包；内部规则见 `packages/opencode/AGENTS.md` |
| `packages/core/` | shared core、flags、global paths、installation/runtime 基础能力 |
| `packages/app/`, `packages/ui/`, `packages/storybook/` | inherited UI surfaces；只在 engine/TUI 需要时改动 |
| `packages/plugin/`, `packages/script/`, `packages/util/` | workspace support packages |
| `packages/sdk/` | SDK workspace；JS SDK regeneration 使用既有脚本 |
| `packages/ellamaka/` | 品牌常量、品牌字模、构建包装、WopalSpace 自动检测、安装路径判断及包级测试 |
| `packages/ellamaka-app/` | Workbench Web UI 前端；内部规则见 `packages/ellamaka-app/AGENTS.md` |
| `packages/ellamaka-desktop/` | Electron 桌面应用，承载 ellamaka-app Workbench 和本地 Ellamaka sidecar；内部规则见 `packages/ellamaka-desktop/AGENTS.md` |
| `docs/` | project DESIGN、BRANDING、DISTRIBUTION、references、research 和 plans |

### 2.1 Wopal 集成模块

| 模块 | 路径 | 职责 |
|------|------|------|
| CLI Adapter | `packages/opencode/src/wopal/cli-adapter.ts` | Effect 服务，通过 ChildProcessSpawner 以绝对路径+参数数组执行 wopal CLI，解析 v1 capability envelope（`wopal.capability/v1`），将 CLI 错误码映射为 Runtime 领域错误（`SpaceControlUnavailable`、`CapabilityContractError`） |
| CLI Contract | `packages/opencode/src/wopal/cli-contract.ts` | 全局 CLI 健康与修复服务。检查 `$WOPAL_HOME/bin/wopal` 的版本兼容性，提供用户确认后的更新或安装恢复，并在修复后重新探测 |
| CLI Schema | `packages/opencode/src/wopal/cli-schema.ts` | CLI envelope、data schema（SpaceEntry、ProjectEntry、DirectoryEntry）、Runtime 领域错误与稳定错误码（`StableErrorCode`）定义 |
| SpaceRegistry | `packages/opencode/src/wopal/space-registry.ts` | 非权威读穿式 Runtime 缓存。通过 CLI adapter 获取 Space 列表、项目列表和目录搜索结果，提供 `refreshSpaces`、`getSpaces`、`refreshProjects`、`searchDirectories` 方法 |
| Session Provisioner | `packages/opencode/src/workbench/session-provisioner.ts` | 受控会话创建。`provisionGeneral` 在 `$WOPAL_HOME/general_tasks/` 下创建唯一目录；`provisionSpace` 只接受已登记 Space 和安全的相对目录，拒绝遍历攻击和未知 Space |
| Session Projection | `packages/opencode/src/workbench/session-projection.ts` | 会话树投影。从 Runtime 数据库全量读取 Session 数据，按已登记 Space 归组；外部 TUI 创建的 Session 自然出现在投影中 |
| Directory Health | `packages/opencode/src/workbench/session-directory-health.ts` | 目录健康检查。返回 `healthy`、`missing` 或 `unavailable`；目录失效不删除 Session |
| Workbench API | `packages/opencode/src/server/routes/instance/httpapi/groups/workbench.ts` | Workbench HttpApi 路由组。`POST /workbench/sessions` 创建受控会话；`GET /workbench/session-groups` 返回含目录健康的全量 Session 投影 |
| Workbench Handler | `packages/opencode/src/server/routes/instance/httpapi/handlers/workbench.ts` | Workbench 端点 handler，将 HTTP 请求转换为领域服务调用，返回含 `directoryHealth` 的 Session 响应 |

### 2.2 测试位置

| 测试文件 | 覆盖范围 |
|----------|----------|
| `packages/opencode/test/server/wopal-cli-adapter.test.ts` | CLI adapter 协议解析、错误映射、Schema 验证、SpaceRegistry 集成 |
| `packages/opencode/test/server/wopal-space-overview.test.ts` | WopalSpace 空间分组逻辑（project root session、子目录、worktree 归属） |
| `packages/opencode/test/server/workbench-session-api.test.ts` | Session provisioner、projection、directory health 服务级测试 |

### 2.3 HTTP API 所有权

| API 域 | HTTP 方法 | 路径 | Owner |
|--------|-----------|------|-------|
| Workbench | POST | `/workbench/sessions` | `SessionProvisioner` + `SessionDirectoryHealth` |
| Workbench | GET | `/workbench/session-groups` | `SessionProjection` + `SessionDirectoryHealth` |
| WopalSpace | GET | `/wopal-space/spaces` | `SpaceRegistry`（通过 CLI adapter） |
| Global | GET | `/global/health` | `CliContract` + Runtime health |
| Global | POST | `/global/cli/repair` | `CliContract`，由用户确认的 Workbench 修复操作调用 |

## 3. Development Commands

| 场景 | 命令 |
|---|---|
| Lint | `bun run lint` |
| 全仓类型检查 | `bun run typecheck` |
| opencode 包测试 | `bun test --timeout 30000 --force-exit`（from `packages/opencode`） |
| opencode 构建 | `bun run build`（from `packages/opencode`） |
| ellamaka 包测试 | `bun test`（from `packages/ellamaka`） |
| 构建 ellamaka 品牌 CLI | `bun packages/ellamaka/build.ts --web-ui ellamaka-app` |
| 构建 CLI 二进制 | `./scripts/build.sh cli` |
| 构建桌面应用 | `./scripts/build.sh desktop` |
| 发布 Desktop beta | `./scripts/tag-release.sh X.Y.Z-beta.N --channel beta --desktop` |
| 发布 Desktop prod | `./scripts/tag-release.sh X.Y.Z --channel prod --desktop` |
| 开发服务（TUI/Workbench/桌面） | `./scripts/dev.sh` |
| 上游合并后精简检查 | `./scripts/check-cleanup.sh` |
| 桌面包测试 | `bun test --preload ./electron-mock.ts --force-exit src`（from `packages/ellamaka-desktop`） |

测试不能从 repo root 运行。`./scripts/dev.sh help` 和 `./scripts/build.sh help` 查看完整参数说明。

## 4. Implementation Rules

### WopalSpace 定制约束

- WopalSpace 定制优先放在新文件；上游文件只保留最小 import 和调用注入点。
- 定制分支使用提前返回 guard，避免与 upstream 主流程改动重叠。
- 新模块需要访问 upstream 内部能力时优先用回调/闭包注入，不直接暴露 upstream Service 类型边界。
- 复用 upstream 逻辑时提取共享 helper，不复制大段 upstream 流程。
- 禁止对 upstream 文件做无关格式化重排、import 重排、dependency 重排或 object key 重排。
- `.gitattributes` 配置了 fork 独有文件的 `merge=ours` 保护，上游合并时自动保留 ellamaka 版本，禁止删除或修改该规则。

### HTTP API 与 SDK 契约

- 新端点遵循 `docs/API-CONTRACT.md`。先确认领域 Owner、Root/Instance 层级、既有 group 和资源语义，再定义 Effect Schema、请求、成功结果、领域错误与兼容性。
- 端点归入 `HttpApiGroup`。全局 WopalSpace 控制能力归 Root API，Session、文件、项目、PTY 和工作目录能力归 Instance API。handler 只转换 HTTP 与领域服务。
- 路径表达领域资源与自然从属关系。查询条件属于 query 参数。文件系统、Shell、CLI 执行和目录 provision 由所属领域服务拥有，不形成浏览器可直接调用的通用原语。
- SDK 由 Effect HttpApi → OpenAPI → `packages/sdk/js/script/build.ts` 自动生成。应用代码使用生成客户端；`packages/sdk/js/src/v2/gen/**` 由生成管线拥有。
- 新增或修改端点必须测试 schema、成功结果、领域错误和 middleware 边界，重新生成 SDK，并同步更新 DESIGN 与 BRANDING。

### Workbench 前端开发

Workbench 前端开发规则（状态所有权、身份作用域、依赖方向、PTY 生命周期、effect 竞态防护、持久化、测试等强制边界）见 `packages/ellamaka-app/AGENTS.md`。本文件不重复这些规则，修改 Workbench 前端代码时必须遵守该规范。

### Desktop 发布契约

- `main` 只用于 `build.sh desktop --channel main` 本地构建验证。发布 workflow 只接受 `beta` 和 `prod`。
- Windows 发布包由原生 Windows CI 构建。macOS 构建不能替代 Windows 运行时验证。
- beta 版本使用 `X.Y.Z-beta.N`，发布到 `ellamaka-desktop/beta/`。prod 发布到 `ellamaka-desktop/`。
- sidecar、Electron Main/Renderer、图标和 electron-builder 共用同一组 channel/version 环境变量。
- macOS 公共包使用 ad-hoc 签名。它保证 bundle 签名结构完整，但用户仍需主动接受 Gatekeeper 风险。
- 同版本重发先清空 R2 版本前缀，再上传完整产物并失效旧对象、当前对象和 latest feed 的 CDN 缓存。
- 下载表展示 DMG、EXE、AppImage、deb 和 rpm。ZIP、blockmap 与 `latest-*.yml` 属于 updater 资产。

## 5. Testing

- 代码类变更遵循 TDD：先写能失败的测试，再实现代码使其通过。
- 尽量避免 mocks；测试真实实现，不要把实现逻辑复制进测试。
- 测试从对应 package 目录运行，不要从 repo root 运行。
- 修改 CLI/runtime/config/plugin/agent/TUI space mode 后，验证或说明：`WOPAL_SPACE` flag、`.wopal/config/settings.*`、TUI settings、plugin loading、theme loading。
- 上游合并后区分 upstream known failures、环境问题和 ellamaka 新引入问题。
- 测试安全运行规则（防挂起与孤儿进程）见空间 `REGULATIONS.md`。

## 6. User-Supplied Rules

- JS SDK 重新生成：`./packages/sdk/js/script/build.ts`。
- 本仓库默认分支是 `main`。`dev` 分支仅跟踪 upstream OpenCode 的 `dev`，用于 merge 集成。
- diff 基准使用 `main` 或 `origin/main`；`dev` 仅作 upstream-tracking。
- 优先自动执行明确请求；遇到缺少关键信息、安全风险或不可逆操作时先确认。
