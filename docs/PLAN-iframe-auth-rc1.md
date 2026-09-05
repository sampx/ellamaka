# 方案：rc.1 browser-auth 下的 iframe 认证（方案 A 落地设计）

日期：2026-09-04。状态：**已完成，愚佛实机验证通过（2026-09-05）**。上游 tag：dsh-v0.1.2-rc.1。实施偏差见文末「实施记录」。

## 0. 为什么需要认证

rc.1 的 dsh web 面引入了 `browser-auth`（`dsh-client-connection` 包，ref-repo `packages/client/connection/src/browser-auth.ts`）：

- `BrowserAuth` 在 Connection 激活时持有进程级 **launch token**（进程 owner 对象上的 WeakMap 单例）。
- 浏览器首次访问 index 时必须携带 `?token=<launch token>`；`authorizeIndex` 校验 GET `/` 上的 token，铸造一张 **authority 绑定的签名 cookie**（HttpOnly、Path=/、SameSite=Strict、默认 30 天），然后 303 到 `/`。
- `/api` RPC 通道上有两层栅栏：Host/Origin trust fence（403）与 `browserAuth.isAuthenticated`（401）。静态资源（assets/favicon）不走认证，公开。
- 没有 token 的裸 `/`（在 iframe 里就是 `/dsh/`）请求直接 401。

官方 CLI 通过 `ctx.connection.authenticatedUrl(baseUrl)` 生成带 token 的 URL 并打印/打开浏览器。Ellamaka 单端口方案把 dsh 面挂在 `/dsh` 前缀下（`mountNodeRoute` 剥前缀后分发），iframe 现在直接拼 `<backend>/dsh/`——rc.1 下必然 401。

## 1. 设计目标

1. 忠实官方：认证流（token → cookie 铸造 → cookie 复用）完全走官方 `BrowserAuth` 代码，不自造签名/会话。
2. 单端口语义：`/dsh/` 挂载点内的一切（含 token 交换的 303、资产、`/api`）对 iframe 是自包含的。
3. dev 拓扑可登录：Vite :3000 → 后端 :4097 的跨站 iframe 也能完成一次登录，之后不再受 SameSite 干扰。
4. 不放宽官方安全面：token 只经 Ellamaka 已认证的 workbench API 下发；trust fence、authority 绑定、HttpOnly 全保留。

## 2. 两个必须解决的前缀/站点冲突

### 2.1 官方 303 Location 写死 `/`

`BrowserAuth.authorizeIndex` 成功铸 cookie 后 `res.writeHead(303, { location: '/' })`。在单端口方案下 `/` 是 Ellamaka 自己的路由。若不改写，iframe 登录完成后会跳出 `/dsh` 面板。解决：`VirtualWebServer.request()` 出站钩子对 **3xx Location 头做前缀改写**（`/` → `/dsh/`，任何以 `/` 开头且未带前缀的 Location 加 `/dsh`）。这与现有 `rewriteIndex`/适配脚本同族（同一适配层职责：官方面说根路径，我们映射到 `/dsh`），不改官方代码。

### 2.2 SameSite=Strict cookie 在 dev 拓扑下永远带不上

cookie 绑定后端 origin（127.0.0.1:4097）。dev 下 iframe 源是 :3000（Vite），浏览器视 :3000→:4097 的 iframe 请求为跨站，`SameSite=Strict` cookie 不随请求发送 → 即使 URL 带 token，iframe 内的 API 请求（不带 token）仍 401。

prod/Desktop（同源）不受影响。解法（dev 专用，零代码面）：`ellamaka-app/vite.config.ts` 的 `server.proxy` 把 `'/dsh'` 代理到后端（`env ELLAMAKA_DSH_PROXY_TARGET`，默认 `http://127.0.0.0.1:4097`）。代理后 iframe 与 cookie 的 origin 都是 :3000（**site 同站**，cookie 正常携带）。Desktop 同源天然成立。

## 3. 落地链路（方案 A）

```
mountDshWeb → DshWebHost.authenticatedPath     # token iframe 路径 "/dsh/?token=..."
     ↓
mountDshEngine (dsh-mount.ts)                   # server.mountNodeRoute 前挂 serve 期认证器
     ↓
workbench dsh-url endpoint (GET /workbench/dsh-url)   # 后端现算现答，绝不持久化
     ↓
前端 DshSurface: server.current?.http.url → /workbench/dsh-url → iframe src
```

### 3.1 VirtualWebServer 出站 Location 改写

`request()` 内对 fallback 与 route handler 的响应加出站钩子：包一层 `res.writeHead`，检测 `location` 头以 `/` 开头且非 `/dsh` 前缀时改写为 `/dsh` + location。`/api` 与 assets 不受影响（不写 3xx Location）。官方 index tap（redirect to clean `/`）与 token 交换 303 都会被改写到 `/dsh/`。

### 3.2 mountDshWeb 暴露 authenticatedPath

`mountProfile` 完成后从 web 容器 ctx 取 `ctx.connection`（官方 `HostConnectionService`，`requestRejection`/`authorizeIndex`/`authenticatedUrl` 都在它身上），暴露为：

```ts
// DshWebHost 新增成员；每次调用现算，不持久化 token
get authenticatedPath(): string
```

实现：`const url = new URL(ctx.connection.authenticatedUrl("http://dsh.invalid"))`，然后把 pathname 置为 `/dsh/`，返回 `url.pathname + "?" + url.searchParams` 的形态（即 `/dsh/?token=...`）。`connection` 服务缺席（理论不发生，web profile 必含 client-connection）时 fail-loud。

### workbench dsh-url endpoint

`DshSurface` 用 `createResource` 调 `sdk.client.workbench.dshUrl()` 拿后端现算的完整 URL（后端拼 `http.url + authenticatedPath`）。iframe src = 该 URL。keep-alive 双层结构不变。

### 3.3 workbench dsh-url endpoint

- Group（`groups/workbench.ts`）：`GET /workbench/dsh-url`，success `{ url: string | undefined }`（Schema.Union [Schema.String, Schema.Undefined]）；handler 返回 undefined 时前端回落原派生（auth 关闭时仍 200 + undefined → 前端直接用 `/dsh/`）。
- 供给：web 容器 `ctx.connection` 在 mount 后从 `dsh-mount.ts` 注册进 `WorkbenchDshUrl.Service`（Effect Layer/Layer.succeed 注入；mount 前 endpoint 返回 undefined）。
- handler：`url = server.url + dsh.authenticatedPath`（后端现算现答，不持久化 token）。

### 3.4 前端消费

`DshSurface` 用 `createResource` 调 `sdk.client.workbench.dshUrl()`，拿后端现算的完整 URL（后端拼 `server.url + dsh.authenticatedPath`）作 iframe src；undefined 时回落原派生（`dshIframeSrc` 保留为回落路径与测试锚点）。
`vite.config.ts` 加 `server.proxy['/dsh']`（dev 修复 SameSite，见 §2.2）。

## 4. 测试计划（TDD）

1. **VirtualWebServer Location 改写**（test/dsh-virtual-webserver.test.ts）：注册 303 fallback/route → 断言 `location: /dsh/...`。
2. **认证流 E2E（mountDshWeb + 真实 fetch）**（test/dsh-web.test.ts）：mount → `GET /dsh/`（宿主直接打 virtual server 时 URL 为 `/`，token 缺失 → 401）→ GET `authenticatedPath`（宿主侧）/ `<backend>/dsh/?token=...`（经 Ellamaka listener 集成测试，token 交换 303 → `/dsh/` 200，后续 `/dsh/api/host.describe` 200）→ 无 token `/dsh/` 401 → 静态 asset 不需认证。
3. **workbench dsh-url**（test/server/workbench-dsh-url.test.ts）：服务缺失 → `{ url: undefined }`；服务在场 → URL 带 token。
4. **前端**（dsh-surface.test.tsx）：有 URL 时 iframe src = API 返回值；undefined 回落 dshIframeSrc。
5. **修 6 个失败 web auth 测试**（dsh-web.test.ts index/api 组）：改为「带 token URL → cookie 交换 → 200」的官方流断言。

## 5. 明确不做（本次范围外）

- 不改 `@deepseek-ai/*` 官方代码；token 只经 Ellamaka 已认证 API 下发，不做免认证豁免面。
- 不做 B 计划（代理层注入认证）。
- token 泄露面评估与 `SameSite` 官方参数化（若官方未来支持 `SameSite=None` 配置可跟进）。
- scope-instances 4 测试与沙箱错误语义 7 测试（B3 遗留，独立小节推进）。
- B2 bun-hmr（下一阶段）。

## 6. 验证命令（全绿 = 收工）

- `cd packages/ellamaka-cordis && env -u DSH_HOME bun test`（209 pass / 3 fail，3 个均为沙箱环境依赖：bash×2 需真实嵌套 sandbox-exec、reify-offline 需 npm cache 写入——已在真实环境复跑全绿）
- `bun run typecheck`（worktree 根，13 包，全绿）
- 前端最小验证链：`check:workbench-boundaries` + `test:unit`（1083 pass）+ `typecheck`（ellamaka-app，全绿）
- SDK 全量再生成：已跑，`dshUrl` 同时命中 types.gen.ts 与 sdk.gen.ts
- 愚佛实机：重启 serve → Workbench 助理 tab iframe 登录一次 → 对话 E2E；B1 两 commit push 与否同场拍板。

## 7. 实施记录（与方案的偏差）

1. **`/api/host.describe` 已随 ApiProxy 移除**：认证流 E2E 的 API 探针改用 rc.1 存活的 exact Fetch 路由 `GET /api/session.export`（缺 sessionId 返回 400——任何非 401/403/404 的服务端应答都证明穿过了认证栅栏）。
2. **rc.1 dist 相对资源路径**：index 用 `./assets/*` + 官方注入 `<base href="/">`；`rewriteIndex` 在根绝对改写外增加了 `./` 相对改写（绝对化后免疫 base 逃逸）。
3. **shippedPresetRoot 删除**：rc.1 把 shipped presets 收进 `@deepseek-ai/dsh-agent-presets` 包（bundle 行自带 `default: standard`，`includeShippedRoot`/`includeUserRoot` 默认接管），rc.2 时代的 host 侧 roots 拼装整段移除；user root 经 `dshHomePath`（已指向 state/）。
4. **WorkbenchDshUrl 双面形态**：CLI mount 侧是普通 async 函数（非 Effect 上下文），采用「模块级单槽 + setDshUrlGetter/getDshUrl 函数」+ 服务薄适配（layer），与 `globalThis.__ellamakaDshContainer` 同款进程单例先例。
5. **`/api/remote.mux` 是 rc.1 唯一官方 upgrade 面**（browserAuth 后面）；dispose-invariant 测试改挂自注册 upgrade 路径。
6. **连带修复（B3 遗留，超出原方案但同日完成）**：
   - `scope-instances` 4 测试：按官方 scoped.spec 重写（minter plugin 注入 + `scope.ctx.tools.register` 直注册）。排查中实锤 bun store 4 份 `dsh-scope` 物化副本、`kScope` Symbol 跨副本失联——**测试侧必须与受测 ToolRuntime 同副本解析 dsh-scope**（生产链路 agent-loop→tools→scope 同副本自洽，无此问题）。
   - 沙箱/审批 7 测试：session fake 缺 rc.1 `snapshotEvents`（session 化沙箱投影源）；补 `makeSessionFake` 共享 fake（snapshotEvents/append/seq/eventAt）。
   - **lock 污染修复**：`generated/dsh-runtime-lock.json` 曾被 tmpdir 符号链污染（580 条 `../..` 前缀键，manifest 指纹失效）；`generate-dsh-runtime-lock.ts` 加键规范化（锚定 `node_modules/` 标记）+ fail-loud，已再生（582 包，0 malformed）。
7. **upgrade dispose 测试时序**：`host.dispose()` 在 bun test 下收尾慢于 socket close；改为「先等 close（被测不变量）后等 dispose」。
8. **lock 生成器新鲜度门禁（指纹漂移事故链）**：`./scripts/dev.sh serve` 报 `dsh runtime lock: fingerprint drift`（runtime lockfile.ts 漂移门禁）。根因是 `generate-dsh-runtime-lock.ts` 只读磁盘 manifest 文件、从不与 package.json 对账：升级定稿 package.json 后磁盘 manifest 停留在中间态（指纹 7195a83b），重生成 lock 时按中间态依赖集整树解析 → lock 绑定一个不存在于 package.json 的指纹，runtime 门禁在 materialise 时拒绝。修复：生成器在解析前用 `buildDshRuntimeManifest(package.json)` 重算期望指纹，与磁盘 manifest 不符即 fail-loud（提示先跑 manifest 生成器）；确认 manifest 正确（892d5933）后整树重生成 lock（582 包），`--check` 双绿。三条门禁各查相邻层（dev.sh 查 manifest↔package.json；runtime 查 lock↔manifest），lock 生成器端到端对账后此事故链闭环。
9. **lock optional 语义（materialise 404 事故）**：实机 `./scripts/dev.sh serve` 报 `dsh.stage.materialise.failed: 404 Not Found - GET https://registry.npmmirror.com/@koromix/koffi-android-x64`。根因两层：koffi 的 16 个平台子包是 `optionalDependencies`（npm 语义 = 装不上可跳过），但 lock 转储只保留 `version` 丢失 `optional` 标记；物化器逐包硬下载，npmmirror 镜像缺 `@koromix/koffi-android-x64@3.2.1`（官方 npm 有，镜像未同步）→ 404 致整个 closure 失败。修复：lock schema 条目加 `optional?: boolean`（生成器从 Arborist package-lock 保留标记；`parseDshRuntimeLock` 校验布尔）；物化器对 optional 包下载失败记 warning 跳过（清残留目录），必装包任何失败照旧硬失败；lock 重新整树生成使 koffi 平台包带 `optional: true`。严格对齐 npm optionalDependencies 语义，镜像缺包不再阻断物化。
12. **facade rc.1 Session 契约对齐（tools 断链，改 workspace 级 dsh-adapter 插件，不入仓库）**：实机工具调用报 `session.snapshotEvents is not a function`，bash/glob/read 全灭。根因：rc.1 Session 从裸事件数组升级为 seq 编号日志，sandbox-policy 折叠（`sessionProjections.stateOf` → `materializeCells` → `snapshotEvents`）与 user-approval 的 hasOpenTurn 反向扫描（`seq` + `eventAt`）都走新读法；dsh-adapter 的 session facade 停在旧契约 `{events[], append}`。修复：`.wopal/plugins/dsh-adapter/index.ts` 的 FacadeSession 对齐官方 Session 读面（seq getter = log.length、eventAt 精确定位、snapshotEvents 半开区间 frozen、append 返回带 seq/time 的 frozen 事件、data 结构化克隆快照），49/49 插件测试绿；实机验证工具调用恢复。改动在 workspace 插件层，仓库内零 diff——profile 禁用 session 持久化的设计下 facade 本就是进程内存语义。
10. **iframe 入口 loopback 别名（实机首验 401）**：实机 iframe 显示 `dsh web authentication required; reopen the URL printed by dsh web`。根因：后端权威入口 URL 绑定 `127.0.0.1:4097`，前端 SDK 记住的 serverUrl 是 `localhost:4097`（entry.tsx dev 默认），`dshIframeSrc` 的 origin 字符串比较把 loopback 别名判为不同源 → token 入口被当 stale 丢弃 → 回落无 token 的 `/dsh/` → authorizeIndex 401。修复：`dshIframeSrc` 的同源判定归一化 loopback 别名（localhost/127.0.0.1/[::1] 同 host 同端口视为同源）；`sameOrigin` helper + 2 个混用 case 测试。端口占用 auto-bump（4096→4097）使该别名差异必然暴露。
11. **vite 代理 Origin 对齐（实机二验 403）**：token 交换与 cookie 铸造通过后 UI 卡「连接中」。根因：rc.1 Host/Origin trust fence（`isTrustedApiRequest`）要求 `Origin.host === Host.host`；vite 代理 `changeOrigin: true` 只改写 Host 不改 Origin（`localhost:3000`），所有 `/dsh/api/*` 与 WS upgrade 403、socket 被关（前端日志 `ws proxy error: socket hang up` 退避重连）。修复：vite 代理 `configure` 钩子在 `proxyReq`/`proxyReqWs` 把 Origin 头对齐 target origin——fence 的单源语义下代理即服务源，same-origin 标记改写后仍真实。`trustedHosts` 救不了此场景（Origin 对比硬编码不走该配置）。实现细节：vite 7 的 `proxyReq.headers` 在出站 ClientRequest 上 pre-send 不可读，Origin 须从回调第二参（原始请求）读取——首版直接读崩了 Vite 进程（dev.sh 拉起失败），已修。
