# Ellamaka API 与 SDK 契约

> **状态**：Active
> **更新时间**：2026-07-15
> **上级架构**：`../../../docs/products/wopal-space/DESIGN-wopalspace.md` §1.1

## 0. 变更记录

| 日期 | 类型 | 摘要 |
|---|---|---|
| 2026-07-15 | Updated | 明确 `GET /workbench/session-groups` 只返回未归档根会话，不暴露归档会话或带 `parentID` 的子会话。 |
| 2026-07-11 | Added | 定义 Effect HttpApi、OpenAPI、生成 SDK 和 Wopal CLI adapter 的统一 Runtime API 契约。 |

## 1. 目的

Ellamaka 的 HTTP API 是 Workbench、官方客户端和外部集成使用运行时能力的唯一网络表面。每个端点同时是服务端契约、OpenAPI 描述和生成 SDK 的来源。

本契约延续 OpenCode 当前的 Effect HttpApi 架构：领域 schema 定义请求、响应和可预期错误；`HttpApiGroup` 定义端点；handler 调用领域服务；OpenAPI 由 API 树生成；JavaScript SDK 从 OpenAPI 自动生成。WopalSpace 定制沿用这条链路，而不是创建旁路 API 或手写客户端。

## 2. API 分层

| 层 | API | 适用领域 | 上下文 |
|---|---|---|---|
| Global / control | `RootHttpApi` | 全局配置、控制面和不依赖工作目录的 WopalSpace 能力 | Authorization |
| Instance | `InstanceHttpApi` | Session、文件、项目、PTY、工具及工作目录相关能力 | Instance Context 与 Workspace Routing |
| Streaming | Event / PTY connect | SSE、WebSocket 与长连接传输 | 专用传输契约 |

端点按领域归入现有 group。一个新 group 代表清晰、独立的领域边界。WopalSpace 的全局注册表和 CLI 集成能力属于 Root API。Session 工作目录、消息和 PTY 属于 Instance API。

## 3. 领域语义与路径

HTTP 路径表达领域资源与自然从属关系。集合使用复数名词，单个资源以稳定标识寻址，筛选和排序使用 query 参数。

| 语义 | HTTP 表达 |
|---|---|
| 集合读取 | `GET /resources` |
| 单项读取 | `GET /resources/{id}` |
| 创建领域资源 | `POST /resources` |
| 更新领域资源 | `PATCH /resources/{id}` |
| 删除领域资源 | `DELETE /resources/{id}` |
| 资源从属集合 | `/resources/{id}/children` |

领域操作以其所属资源和产生的领域状态命名。服务端内部的文件系统、Shell、任意目录创建和 CLI 执行属于领域服务实现，不形成浏览器可直接调用的通用原语。General Session 工作目录由 Session Runtime 内部 provisioner 管理。

视图专用投影仍是明确的读模型。它声明所属领域、输入、输出和刷新边界，并使用资源范围表达归属。产品设计决定投影名称和路径，避免以临时 UI 名称扩展公共 API。

`GET /workbench/session-groups` 是 Workbench 左侧会话列表的 Root 级读模型。它按 Space/General 分组，只返回数据库中 `time_archived IS NULL` 且 `parent_id IS NULL` 的 Session；归档会话和子会话不得进入响应、`sessionCount` 或客户端 Session Projection。

## 4. Schema、错误与版本

### 4.1 Schema 是契约真相源

每个端点在 API group 中声明 query、payload、success 和 error schema。领域模型或 group-local schema 同时服务运行时校验、OpenAPI 和 SDK 类型生成。

- API 输入与输出使用 Effect Schema 表达准确类型和可选性。
- 可预期领域失败使用显式 `Schema.ErrorClass` 或 `Schema.TaggedErrorClass`，提供稳定 code 与调用方可处理的语义。
- `HttpApiError` 适用于通用 HTTP 失败。SDK 可见的领域失败使用具名 schema。
- handler 返回领域 schema 所声明的结果，不以 `any`、未声明对象或字符串解析替代契约。

### 4.2 兼容性

当前主版本内的 API 通过新增可选字段和新增端点演进。字段删除、重命名、类型变化、语义变化、默认行为变化和可选变必填构成破坏性变更。

破坏性变更创建新的明确 API 版本或并行的替代资源。旧契约在声明的迁移窗口内保持可用，并在 OpenAPI 中标记替代关系。调用方忽略未知可选字段，并以公开错误 schema 而非错误文案处理失败。

API 路径版本只服务破坏性版本演进。局部字段变化不通过临时 query 参数、隐式响应分支或手写 SDK 补丁表达。

## 5. OpenAPI 与生成 SDK

`OpenCodeHttpApi` 是 API 组合根。每个 group 提供稳定的 OpenAPI identifier，端点提供稳定的 operation identifier。OpenAPI 生成流程从运行中 API 树导出规范，`packages/sdk/js/script/build.ts` 使用 `@hey-api/openapi-ts` 生成 `packages/sdk/js/src/v2/gen/` 的类型和客户端。

```text
Effect Schema + HttpApiGroup
  → OpenCodeHttpApi
  → OpenAPI document
  → generated TypeScript types + OpencodeClient methods
  → ellamaka-app / external consumers
```

生成目录由 SDK 构建管线拥有。应用代码通过生成客户端调用端点。新增或修改端点后，实施者重新生成 SDK、审阅生成 diff，并让消费端使用生成方法。手写生成文件无法形成稳定契约。

## 6. Wopal CLI 集成

Ellamaka 的 Wopal CLI adapter 是 Runtime API 的领域服务。它以绝对可执行路径和参数数组调用已登记的 `wopal ... --json --api-version` capability，验证结构化结果，映射稳定 CLI 错误码，并维护非权威查询快照。

Runtime API 面向 Workbench 暴露 Ellamaka 领域资源与投影，而不是透传 CLI 命令、CLI JSON envelope 或底层 filesystem 参数。CLI 管理的 settings、Git 和 ontology 状态保持事实来源。Session、PTY、消息和 General Session 工作目录由 ellamaka 直接拥有。

## 7. 端点设计门禁

新增或修改 API 时，实施者完成以下检查：

1. 确认领域 Owner、Root/Instance 层级和现有 group，选择最小的扩展点。
2. 在设计中说明资源语义、路径、输入、成功结果、可预期错误和兼容性。
3. 使用 Effect Schema 和 `HttpApiGroup` 定义契约；handler 只负责 HTTP 到领域服务的转换。
4. 在 API 组合根和 handler layer 注册 group，继承正确的 Authorization 与 Instance Context middleware。
5. 重新生成 SDK，不手写 `src/v2/gen/**`。
6. 测试 schema 验证、成功路径、领域错误、授权或工作区路由边界，以及生成客户端调用。
7. 更新对应领域设计、BRANDING 注入记录和本契约的变更记录。

## 8. 现有端点迁移

本契约适用于所有新端点。已有 WopalSpace 端点在其下一次相关功能变更时按本契约审查和迁移。迁移保持已发布消费者可用，并将 schema、operation identity、SDK 生成与领域所有权收敛到同一条链路。

## 9. 相关文档

| 文档 | 职责 |
|---|---|
| `docs/DESIGN.md` | Ellamaka 的运行时职责、状态归属和 API 架构概览。 |
| `docs/BRANDING.md` | WopalSpace API 的现有注入点和实现事实。 |
| `../../../projects/wopal-cli/docs/CAPABILITY-PROTOCOL.md` | CLI capability 的机器输入、JSON 输出和版本规则。 |
| `packages/opencode/src/server/routes/instance/httpapi/AGENTS.md` | Effect HttpApi 的实现模式。 |
| `packages/sdk/js/script/build.ts` | OpenAPI 到 JavaScript SDK 的生成入口。 |
