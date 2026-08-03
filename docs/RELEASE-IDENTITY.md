# Ellamaka — Release Identity and Compatibility Contract

> **状态**: Draft
> **更新时间**: 2026-08-03
> **Owner**: Ellamaka release system
> **适用产品**: `ellamaka-cli`、`ellamaka-desktop`

## 1. Scope

本文是 Ellamaka 产品版本、OpenCode 上游来源、构建溯源和跨产品兼容性的唯一真相源。`DISTRIBUTION.md` 负责发布流程、制品和 CDN；Desktop、Wopal CLI 与 wopal-site 只消费本文契约，不复制版本算法。

Release identity 必须回答四个互不混淆的问题：

1. 这是哪个 Ellamaka 产品的哪个版本？
2. 它采用了哪个 OpenCode baseline？
3. 它与哪些外部组件兼容？
4. 它由哪个 Ellamaka commit、tag 和构建生成？

## 2. Design Principles

1. **产品版本独立**：Ellamaka CLI 与 Ellamaka Desktop 是两个独立发布单元，各自使用标准 SemVer 2.0、tag、workflow、latest feed 和 changelog。
2. **上游不是产品版本**：OpenCode version/commit 是 provenance 与 v1 兼容基线，不参与 Ellamaka 产品版本排序。
3. **兼容性不是版本相等**：Desktop 不锁定外部 CLI 的精确产品版本；安装器读取 CLI stable `latest` 并验证其满足 Desktop 兼容约束。
4. **一个排序真相源**：发布顺序只比较 `releaseIdentity.version`。upstream、build date、Git hash、artifact hash 和 `testedWith` 都不参与排序。
5. **提交后不可变**：有效 versioned manifest 是正式发布提交点；提交后同一个 `product + version` 只能对应一个 source tag、一个 Ellamaka commit 和一组固定 artifact hashes。提交前失败 attempt 可受控清理并同版本重试。
6. **安全迁移**：新 manifest 在迁移期保留必要的顶层兼容字段；旧 `X.Y.Z-N` 只读不写，不继续扩展自定义排序体系。

## 3. Public API and SemVer

Ellamaka 发布的 `version` 遵循 SemVer 2.0：

- MAJOR：Ellamaka 对外公共契约发生不兼容变化。
- MINOR：新增向后兼容能力，或完成较大的向后兼容上游同步。
- PATCH：向后兼容的 bug、安全或兼容性修复。
- prerelease：Desktop 只使用 `-beta.N`。CLI 不发布 prerelease（rc 机制已移除），每次发布直接递增 patch/minor。

Ellamaka 的公共契约至少包括：

- CLI 命令、参数、退出码和机器 JSON capability。
- Engine HTTP/API、事件、配置和持久化兼容边界。
- Desktop 与 sidecar/外部 CLI 的通信和启动门禁。
- release manifest schema、安装路径和更新协议。
- 对外 SDK、plugin 与 extension 接口。

发布版本采用以下规范子集：

```text
CLI stable:   X.Y.Z
Desktop beta: X.Y.Z-beta.N
Desktop prod: X.Y.Z
```

发布版本禁止 `+build` metadata。SemVer 允许 build metadata，但它不参与 precedence；允许它会产生两个不同构建排序相等的问题。构建信息统一放入结构化 `build` 字段。

## 4. Product Boundaries

### 4.1 Ellamaka CLI

`ellamaka-cli` 是可独立安装的 Engine/CLI 产品，支持 Wopal 完整安装、headless 安装和手动下载。其 SemVer 表达 CLI 与 Engine 公共契约的演进。

### 4.2 Ellamaka Desktop

`ellamaka-desktop` 是原生 Electron 产品，拥有独立的 UI、平台集成、签名、公证、自动更新、stable/beta channel 和回滚边界。其 SemVer 不随 CLI 的每次修复锁步递增。

### 4.3 Embedded Sidecar

Desktop sidecar 是从当前 Ellamaka source commit 构建的 Node runtime，不是外部 CLI binary，也不是第三个面向用户的发布产品。Desktop manifest 记录 sidecar 的 source commit、OpenCode baseline 和 engine API，但不为它创建第三套 SemVer。

共享 Engine 源码发生变化时，CLI 与 Desktop 可能需要协调发布；协调发布不要求二者版本相同。

## 5. Canonical Manifest

### 5.1 CLI Manifest

```json
{
  "manifestSchemaVersion": 2,
  "version": "1.17.1",
  "releaseIdentity": {
    "schemaVersion": 2,
    "kind": "release",
    "product": "ellamaka-cli",
    "version": "1.17.1",
    "channel": "stable",
    "upstream": {
      "name": "opencode",
      "version": "1.15.13",
      "gitCommit": "<40-char-upstream-commit>"
    },
    "build": {
      "sourceTag": "ellamaka-cli-v1.17.1",
      "gitCommit": "<40-char-ellamaka-commit>",
      "builtAt": "2026-08-03T08:30:00Z",
      "workflowRunId": "123456789"
    }
  },
  "capabilities": {
    "engineApi": "1.2.0"
  },
  "artifacts": [
    {
      "name": "ellamaka-darwin-arm64.tar.gz",
      "os": "darwin",
      "arch": "arm64",
      "url": "https://download.coursedao.com/ellamaka/v1.17.1/ellamaka-darwin-arm64.tar.gz",
      "sha256": "<artifact-sha256>",
      "size": 123456
    }
  ],
  "checksumsUrl": "https://download.coursedao.com/ellamaka/v1.17.1/checksums.txt"
}
```

### 5.2 Desktop Manifest

```json
{
  "manifestSchemaVersion": 2,
  "version": "1.16.2",
  "releaseIdentity": {
    "schemaVersion": 2,
    "kind": "release",
    "product": "ellamaka-desktop",
    "version": "1.16.2",
    "channel": "stable",
    "upstream": {
      "name": "opencode",
      "version": "1.15.13",
      "gitCommit": "<40-char-upstream-commit>"
    },
    "build": {
      "sourceTag": "ellamaka-desktop-v1.16.2",
      "gitCommit": "<40-char-ellamaka-commit>",
      "builtAt": "2026-08-03T08:30:00Z",
      "workflowRunId": "123456789"
    }
  },
  "embeddedComponents": {
    "sidecar": {
      "gitCommit": "<40-char-ellamaka-commit>",
      "engineApi": "1.2.0",
      "upstreamBaseline": "1.18.10"
    }
  },
  "requirements": {
    "externalCli": {
      "product": "ellamaka-cli",
      "channel": "stable",
      "engineApi": ">=1.2.0 <2.0.0",
      "upstreamBaseline": "1.15.13",
      "selection": "latest"
    },
    "wopalCli": ">=0.3.8"
  },
  "testedWith": {
    "ellamakaCli": "1.17.1"
  },
  "artifacts": []
}
```

### 5.3 Field Authority

| 字段                         | 权威来源                  | 是否参与发布排序                  |
| ---------------------------- | ------------------------- | --------------------------------- |
| `releaseIdentity.product`    | 发布目标                  | 否，只用于隔离产品                |
| `releaseIdentity.kind`       | build mode                | 否，只区分正式发布与开发构建      |
| `releaseIdentity.version`    | namespaced product tag    | 是，标准 SemVer                   |
| `releaseIdentity.channel`    | SemVer prerelease + feed  | 先过滤 channel，不跨 channel 排序 |
| `upstream.version/gitCommit` | upstream lock             | 否                                |
| `build.sourceTag`            | 触发发布的 namespaced tag | 否                                |
| `build.gitCommit`            | workflow checkout commit  | 否                                |
| `build.builtAt`              | release context 生成时间  | 否                                |
| `capabilities.engineApi`     | Engine API contract       | 只用于兼容过滤                    |
| `testedWith`                 | release integration test  | 否，不是安装 pin                  |
| artifact `sha256`            | 实际构建产物              | 否，只用于完整性                  |

顶层 `version` 是 `releaseIdentity.version` 的兼容别名，二者必须完全相等。无需再增加 `displayVersion`。迁移期可保留旧顶层 `build`，但它必须等于 `releaseIdentity.build.gitCommit`，消费者迁移完成后删除。

`channel` 与 SemVer 必须一致：stable 不含 prerelease；Desktop beta 只接受 `-beta.N`。Desktop 内部 feed 名 `prod` 映射为 identity channel `stable`。CLI 不发布 prerelease。

### 5.4 Runtime Identity Surfaces

manifest 只能证明远端 release，不能单独证明本机正在运行的 binary/app。release build 必须把同一个 release context 嵌入产物，并提供只读身份表面：

- CLI 内嵌 ReleaseIdentity 与 `capabilities.engineApi`，通过 `ellamaka debug release-info --json --api-version 1` 输出 `{ releaseIdentity, capabilities }`。命令不访问网络、不读取安装收据；`ellamaka --version` 继续只输出产品 SemVer，供人类和轻量探测使用。
- Desktop package 在 resources 中内嵌 `release-identity.json`。Main 启动时验证其 product/version 与当前 app package version、channel/appId 一致，再用于 updater、兼容门禁和诊断。
- `$WOPAL_HOME/ellamaka/state/ellamaka-install.json` 只缓存安装来源、artifact hash 和上次探测 identity。Wopal status/repair 必须以 binary machine identity + 实际 artifact/文件探测为准，不能仅信任收据。

ReleaseIdentity 是显式判别联合：

- 正式产物固定 `kind: "release"`，并要求标准发布 `channel`、`build.sourceTag`、40 位 `build.gitCommit`、`build.builtAt` 和 `build.workflowRunId` 全部存在；它只能来自 namespaced product tag。
- 本地/开发产物固定 `kind: "development"`，使用 `channel: "local" | "main"` 和清楚可辨的开发版本；允许记录当前 `gitCommit` / `builtAt`，但禁止出现 `build.sourceTag` 或 `build.workflowRunId`，也不能进入正式 manifest、versioned path 或 latest alias。

开发 identity 示例：

```json
{
  "schemaVersion": 2,
  "kind": "development",
  "product": "ellamaka-cli",
  "version": "0.0.0-dev.385cb694",
  "channel": "local",
  "build": {
    "gitCommit": "<40-char-ellamaka-commit>",
    "builtAt": "2026-08-03T08:30:00Z"
  }
}
```

consumer 必须先按 `kind` 选择 schema，再校验对应 required/forbidden fields；缺失、损坏或未知 kind 都是不可确认身份。release workflow 必须断言 CLI machine identity、Desktop embedded identity、manifest 和该产品 workflow 内唯一的 release context 完全一致。CLI 与 Desktop 各自生成并在自身 matrix 内共享 context，不要求两个产品复用同一 context 文件。

## 6. OpenCode Upstream Lock

OpenCode baseline 不是每次 build/release 的人工输入。仓库维护一个受版本控制的单一真相源：

```text
release/upstreams.lock.json
```

```json
{
  "schemaVersion": 1,
  "sources": {
    "opencode": {
      "relationship": "baseline",
      "repository": "https://github.com/anomalyco/opencode.git",
      "version": "1.15.13",
      "gitCommit": "385cb694419f98103af0e8fc6187ddcbcbb6eecb"
    }
  },
  "componentBaselines": {
    "packages/app": {
      "source": "opencode",
      "sourcePath": "packages/app",
      "version": "1.15.13",
      "gitCommit": "385cb694419f98103af0e8fc6187ddcbcbb6eecb"
    },
    "packages/desktop": {
      "source": "opencode",
      "sourcePath": "packages/desktop",
      "version": "1.15.13",
      "gitCommit": "385cb694419f98103af0e8fc6187ddcbcbb6eecb"
    }
  }
}
```

`sources.opencode` 是 Ellamaka Engine 当前正式采用的 OpenCode baseline，也是 v1 外部 CLI 兼容过滤使用的 baseline。`componentBaselines` 记录仍按独立复制策略冻结的上游目录来源，只用于 drift 检查和审计，不参与产品版本排序或 CLI 兼容过滤。这样，Ellamaka 可以把 Engine 合并到 OpenCode `1.15.13`，同时继续明确记录 `packages/app` / `packages/desktop` 冻结在同一版本；只有主动升级对应复制基线时才修改相应 component entry。当 Engine baseline 升级到更高版本（例如 `1.18.10`）而 component 仍冻结在旧版本时，两者会在 lock 中分别体现。

只有“正式采用新的 OpenCode Engine baseline”时才更新 `sources.opencode`。专用命令接收目标 OpenCode version，解析上游 tag 对应的完整 commit，校验后写入 lock；baseline 更新与上游合并在同一变更中审查和提交。component baseline 使用独立的显式更新动作，禁止被 Engine baseline 升级顺带改写。release workflow 禁止通过 input、环境变量或网络上的“最新 OpenCode tag”覆盖 lock。

发布前必须验证：

1. lock 通过 schema 校验，所有 version 均为稳定 SemVer，commit 均为完整 40 位 SHA。
2. `sources.opencode.gitCommit` 存在，并且是 Ellamaka release commit 的祖先。
3. 冻结目录检查分别读取自己的 `componentBaselines[<path>].gitCommit`，并验证工作树目录与该 upstream snapshot 一致。
4. release context 保存整个 lock snapshot；公开 manifest 的 `releaseIdentity.upstream` 与构建内嵌 Engine metadata 必须等于 `sources.opencode`。

v1 中 `relationship: "baseline"` 表示它同时参与兼容过滤。v2 可改为 `"provenance"`，或者移除 OpenCode source；ReleaseIdentity schema、产品 SemVer 和构建溯源不变。

## 7. Compatibility and Latest Consumption

### 7.1 v1 Compatibility

完整产品安装固定读取当前 CLI stable latest：

```text
https://download.coursedao.com/ellamaka/latest/manifest.json
```

读取后必须同时满足：

1. `product === "ellamaka-cli"`。
2. CLI channel 必须等于 `requirements.externalCli.channel`；Desktop stable 和 beta 默认都声明 `stable`。
3. CLI `releaseIdentity.upstream.version` 与 Desktop `requirements.externalCli.upstreamBaseline` 的完整 `X.Y.Z` 相等。
4. CLI `capabilities.engineApi` 满足 Desktop `requirements.externalCli.engineApi` SemVer range。
   Desktop 的 `testedWith.ellamakaCli` 只记录发布验证版本，不是精确安装要求。默认安装不得恢复为 `engineVersion` pin，也不搜索历史 CLI。CLI latest 不满足全部要求时，安装必须以明确的 compatibility error 终止并建议刷新或重试；不得退回某个旧 versioned manifest、最近 baseline、`testedWith` 或低一档 engine API。

### 7.2 Current-Release Support Policy

自动安装只支持当前公开推荐组合：Desktop stable latest、Desktop beta latest（若已发布）和 CLI stable latest。版本化 manifest/artifact 继续保留用于审计、手动回滚和显式迁移，但不建立 release index，也不用于默认兼容版本搜索。

因此发布系统必须保证：

1. CLI stable latest 是独立发布面：CLI 发布不受任何 Desktop 版本约束，latest 直接更新。
2. 发布 Desktop 时，其 requirements 必须与当前 CLI stable latest 兼容；不兼容时 fail closed，先发布兼容的 CLI。
3. OpenCode baseline 或 engine API breaking boundary 变化时，CLI 先行发布并更新 latest；Desktop 随后发布并校验 CLI latest 满足 requirements。
4. aliases 顺序更新产生的短暂不一致由 consumer fail-closed 并提示重试，不通过历史版本搜索掩盖发布事务错误。
5. 较旧 Desktop 若已不符合当前 CLI latest，必须先更新 Desktop；自动 repair 不为它回退安装旧 CLI。

这一策略保持发布面简单。只有产品将来明确承诺长期支持旧 Desktop baseline 时，才另行设计带 EOL 与签名约束的版本索引；不能在没有该产品承诺时预先引入。

### 7.3 v2 Compatibility

Ellamaka v2 不再要求 OpenCode baseline 相等。Desktop 从 `requirements.externalCli` 省略 `upstreamBaseline`，CLI latest 校验只保留 product、channel 和 engine API range；upstream 若存在，仅用于 provenance。

## 8. Tags, Channels, and Release Workflows

产品 tag 使用独立命名空间：

```text
ellamaka-cli-v1.17.1
ellamaka-desktop-v1.16.2
ellamaka-desktop-v1.17.0-beta.1
```

禁止再创建通用 `vX.Y.Z` Ellamaka tag，避免与 OpenCode 上游 tag 冲突。CLI 与 Desktop workflow 独立触发、独立 checkout tag、独立发布和回滚。可以提供一次协调触发两个 workflow 的命令，但它必须接收两个独立版本，不能重新引入共享版本身份。

`tag-release` 只接收目标 product 和显式 Ellamaka product version，不接收 OpenCode baseline/revision，也不自动生成 `-N`。它必须在写入前校验：版本符合本文 SemVer 子集、version/channel 一致、目标 namespaced tag 和 versioned path 状态、目标版本未列入 `release/withdrawn-versions.json` 且高于该产品已发布的最高标准版本；第一批标准版本还必须高于 §12 的 migration floor。已提交 release 的 tag 永远不得删除或移动；无有效 versioned manifest、latest/updater 或正式 Release 页面引用的失败 attempt 可在证明 ownership 后受控清理并从修复 commit 重建 tag。OpenCode baseline 始终由 upstream lock 随最终 source commit 确定。

重试状态固定如下：不存在 tag 且 versioned path 为空时可创建新 release；tag/partial objects 存在但没有有效 versioned manifest、latest/updater 或正式 Release 页面引用时，只有显式 `retry` 才能清理该 attempt 可证明 ownership 的对象，并允许从修复后的 commit 重建 tag、同版本重新 dispatch；有效 immutable manifest 已提交时只能重试 release page 或 latest promotion，不能重新 build。已提交 release 出现 identity/hash mismatch 或重大运行问题时执行 §9.2 整版 withdrawal，版本号永久作废，后续使用更高版本。

channel 规则：

- CLI 只有 stable channel：每次发布都是正式版，latest 总是指向最新发布的 CLI 版本。
- stable latest 只引用无 prerelease 的版本。
- Desktop beta latest 只引用 `-beta.N`，并与 stable 使用不同 appId/feed。
- 不进行隐式跨 channel 更新或比较。

## 9. Release Context and Immutability

每个 workflow checkout 精确 product tag 后，先生成一次 `release-context.json`，CLI/Desktop build、manifest、release notes 和上传步骤全部读取同一文件：

```text
product/version/channel  ← namespaced tag
upstream                 ← release/upstreams.lock.json
build.gitCommit          ← checked-out release commit
build.builtAt            ← UTC release-context assembly time
artifacts                ← build outputs + SHA-256
```

workflow input 不能作为 version 或 upstream 的第二真相源。输入若为兼容旧入口而暂时存在，只能断言它等于 tag/lock，不能覆盖二者。

immutable publication 使用 manifest-last commit protocol：先在 workflow-run staging prefix 上传并校验全部 artifacts/metadata，再以禁止覆盖的写入复制到目标 versioned path，最后才写入 `manifest.json` 作为正式发布提交点并回读验证。目标路径出现部分对象但没有有效 manifest 时属于 failed attempt，不是已发布版本；只有在确认没有 latest/updater/Release 页面引用，并能用 workflow run/transaction metadata 证明对象 ownership 时，才允许显式清理后从修复 commit 同版本重试。无法证明 ownership 时 fail closed。

versioned manifest 已提交后，mutable latest promotion 可以独立重试，但必须直接读取已提交的 immutable release，不重新构建或生成第二份 release context。新的 workflow dispatch 不能接管已经提交或部分写入的同一 product/version。

版本化 R2 路径不可覆盖。若 source、配置或 artifact 有任何变化：

- stable 增加 PATCH；
- Desktop beta 增加 prerelease 序号；
- 创建新的 namespaced tag 和 versioned path。

已提交的正式 release 禁止 retag。cleanup 对未知 tag/manifest fail-closed；解析失败的对象报告错误并保留，不默认删除。latest 引用对象在任何 retention 规则之前受到保护；正式 namespaced product tag 不进入普通 retention 删除候选，只有 §9.2 显式 withdrawal 能在健康 aliases 恢复后删除指定失败版本的 tag。

### 9.1 Cleanup Contract

release cleanup 不得使用字符串比较、`sort -V`、文件修改时间或旧 `X.Y.Z-N` comparator 推断“更新版本”。它先构建 release reference graph：

1. 分别读取 CLI stable latest、Desktop stable latest、Desktop beta latest 和 updater feed。
2. 校验引用的 product/channel/version 与目标 versioned manifest 一致。
3. 将所有 latest/updater 直接引用的 release 标记为 protected。
4. 只在同一 product/channel 内用标准 SemVer 评估明确的 retention 候选；legacy release 由 legacy reader 分类，但不与新 release 混排后自动删除。
5. 未知目录、schema 错误、悬空引用或 hash 不一致的对象全部保留并使 cleanup 失败。

cleanup 输出待删除对象与保护原因的审计清单后才执行。mutable latest aliases 和正式 product tags 不属于 retention cleanup 的删除候选。任何 cleanup 失败都不能阻止客户端继续读取上一次有效 aliases。

### 9.2 Failed Attempt and Whole-Version Withdrawal

发布失败处理只保留两个边界：

1. **提交前 retry**：不存在有效 versioned manifest，且目标版本未被 latest/updater/正式 Release 页面引用时，可精确清理失败 attempt 的 staging、partial objects 和尚未提交的 product tag；修复 workflow 或 source 后允许同版本重试。
2. **提交后 withdraw**：有效 versioned manifest 已提交但版本存在重大运行、identity、hash 或打包问题时，先把该 `product + version` 写入受版本控制的 `release/withdrawn-versions.json`，再把受影响 latest/updater aliases 恢复到显式指定并验证兼容的健康版本，回读并 purge CDN，最后删除该版本完整 R2 prefix、GitHub/Gitee Release 页面和正式 product tag。

`withdrawn-versions.json` 使用最小、受版本控制的 schema，数组内版本唯一并按标准 SemVer 排序：

```json
{
  "schemaVersion": 1,
  "products": {
    "ellamaka-cli": ["1.17.1"],
    "ellamaka-desktop": ["1.16.2"]
  }
}
```

该文件是 tag allocator 防止版本复用的唯一真相源；它不参与版本 precedence，也不形成在线 release index 或 consumer revocation API。操作员必须先将待撤回版本加入该文件并提交，再运行 withdraw dry-run/apply；workflow 回读当前 ref 中的记录后才允许远端删除。withdraw 支持相同输入的幂等重试；未记录 withdrawn、仍被 alias 引用、fallback 未验证或删除范围不能精确限定到单一 product/version 时一律 fail closed。已撤回版本永久跳过，修复使用更高 PATCH 或 prerelease 序号。

## 10. Update Authorization

更新决策按以下顺序执行：

1. 校验 manifest schema、product、channel 和不可变字段。
2. 按兼容契约校验目标 latest manifest。
3. 使用标准 SemVer 比较同一产品、同一 channel 的 `releaseIdentity.version`。
4. 校验预期 version、source identity 和 artifact SHA-256。
5. 在修改本机前先形成包含 Desktop、外部 CLI 和 Wopal CLI requirement 的完整安装计划，并确认所有 manifest 和下载均可验证。
6. 才允许按“外部 CLI → Desktop → 最终健康检查与收据”的顺序落盘；失败不得把未验证的部分安装状态报告为成功。

Desktop 保留自己的 manifest policy gate。electron-updater 负责平台 feed、下载、签名检查和安装，不单独决定跨 channel、兼容性或 release identity 授权。其返回的 update version 必须等于已经授权的 Desktop manifest version。

## 11. Coordinated Release Policy

| 变更                                     |   CLI    |  Desktop   |
| ---------------------------------------- | :------: | :--------: |
| CLI 参数、headless、独立 binary 修复     |   发布   |   不发布   |
| Desktop UI、Electron、窗口、updater 修复 |  不发布  |    发布    |
| 共享 Engine/API/数据库变更               |   发布   |    发布    |
| 新 OpenCode baseline                     | 通常发布 |  通常发布  |
| Desktop beta UI 验证                     |  不发布  | 发布 beta  |
| Electron/Chromium 紧急安全更新           |  不发布  | 发布 patch |

每个产品 publish workflow 只负责构建并提交自己的 immutable versioned release，并更新自己的 latest 别名。CLI 是独立产品，发布与最新版本从不依赖 Desktop；Desktop 是 CLI 的消费者，其发布必须保证 CLI stable latest 满足自己的 requirements。

发布顺序约定为 CLI 先行、Desktop 后发：

- CLI 发布时直接更新 CLI stable latest，不受任何 Desktop 版本约束。
- Desktop stable/beta 发布前校验当前 CLI stable latest 满足自身 requirements（product、channel、upstream baseline、engine API range）；不满足时 fail closed 并提示先发布兼容的 CLI。
- 旧 Desktop 用户启动时若发现 CLI 不兼容，通过 Setup Center 的 `install-engine` 下载并校验 CLI stable latest；仍不满足则提示更新 Desktop，不搜索历史 CLI，不静默回退。
- CLI stable 只能进入 stable alias；Desktop stable 只能进入 stable alias，beta 只能进入 beta alias。

不存在跨产品的 latest 协调流程：CLI 永不等待 Desktop，Desktop 永远自我适配。短暂的不一致窗口由 consumer fail-closed 并提示重试，不通过历史版本搜索掩盖发布事务错误。

## 12. Legacy Migration

历史 `X.Y.Z-N` 和 `X.Y.Z-N.rcM` 保持不可变归档。迁移 reader 可以将它们解析为 legacy identity，供识别当前安装和迁移路径使用，但新 publisher 不再生成这些格式，也不把 legacy comparator 用于新 release。

第一批标准 Ellamaka 产品版本必须在 SemVer precedence 上高于所有已发布 legacy 版本。legacy `X.Y.Z-N` 是 prerelease，同 base 的正式版 `X.Y.Z` 在 SemVer 2.0 中天然高于它，因此 migration floor 是最高 legacy 版本的同 base 正式版（如 `1.15.13-4` → floor `1.15.13`）；同 base 版本本身已被 tag/R2 占用检查拦截，后续 patch（`1.15.14`）可跟随 OpenCode baseline 发布。实际版本由迁移时的最高已发布版本决定。

切换前必须生成一次 legacy inventory：记录现存 tag、R2 versioned path、manifest、artifact SHA-256、channel alias 和可确认的 source commit，并从此冻结。若历史上同一个 legacy version 曾被覆盖，只能把切换时仍可验证的 R2 snapshot 归档为当前事实；无法重建的旧 build 不得伪造 identity。检测到本机 legacy binary 与 inventory hash 不一致时，将其标记为 `legacy-unknown-build`，允许迁移到第一批标准版本，但不能据此覆盖或回写历史 release。

迁移期顺序：

1. 生成并审查 legacy inventory 与 migration floor，冻结当前 tag/R2 snapshot。
2. 先发布支持新旧 manifest 的 reader 和固定 fixtures。
3. publisher 双写顶层兼容字段与结构化 ReleaseIdentity。
4. tag、workflow、latest 和 cleanup 切换到新规则。
5. Desktop 与 Wopal CLI 分别迁移消费者。
6. 达到旧客户端淘汰门槛后再删除旧字段和 legacy parser；历史对象不重写。
