# scripts — 构建、开发与发布脚本

本目录集中了 ellamaka 的构建、开发、发布与上游合并工具。所有脚本基于脚本自身位置解析项目根，因此**可在任意 worktree 内执行**，产物落在当前 worktree 的 `dist/` 等目录，不污染 main。

## 构建与发布

### `build.sh` — 编译 CLI / Desktop

```bash
./scripts/build.sh cli [options]      # 构建 CLI 二进制（本机跨平台）
./scripts/build.sh desktop [options]  # 构建 Electron 桌面应用
```

CLI 常用选项：

| 选项 | 说明 |
|------|------|
| `--channel <main\|prod>` | 渠道（默认 `main`）。`main` → `ellamaka-main.db`；`prod` → `ellamaka.db`（共享发布库） |
| `--version <ver>` | 覆盖构建版本 |
| `--platform <mac\|linux\|win>` | 目标平台（逗号分隔） |
| `--arch <arm64\|x64>` | 目标架构（逗号分隔） |
| `--web-ui <value>` | 内嵌 Web UI：`ellamaka-app`（默认）、`app`、`none` |
| `--install` | 安装二进制（软链到 `~/.wopal/bin`） |

Desktop 平台策略：本机 mac + `--platform mac`（默认）→ 本地构建；`--platform linux\|win` → dispatch GitHub Actions CI 并下载产物。CI 构建仅接受 `--channel beta\|prod`（`main` 仅本地）。

### `release.sh` — 发布 CLI / Desktop 版本

```bash
./scripts/release.sh <cli|desktop> [version] [--channel <beta|prod>] [--dry-run] [--no-cleanup]
```

创建版本 tag 并 dispatch 发布 workflow。版本省略时自动推荐（渠道最高 tag 无有效 manifest 则重发，否则推荐下一版本）。`--dry-run` 只打印发布计划不执行。

### `withdraw-release.sh` — 整版撤回已发布版本

```bash
./scripts/withdraw-release.sh <cli|desktop> [--channel <stable|beta>] [version] [--dry-run]
```

按 `docs/DISTRIBUTION.md §7.3` 撤回：登记到 `release/withdrawn-versions.json`，再 dispatch cleanup 的 withdraw 模式执行远端删除。版本默认取该渠道最新发布版本，fallback 为该渠道上一版本。

## 开发

### `dev.sh` — 本地开发服务器

```bash
./scripts/dev.sh <command> [options]
```

| 命令 | 说明 |
|------|------|
| `tui` | 启动 TUI（默认进程内后端） |
| `serve` | 启动 HTTP 后端 + Workbench |
| `restart [target]` | 重启后端 / Workbench / 全部 |
| `status` | 显示运行中的开发实例 |
| `desktop` | 构建并启动 Electron 桌面应用（后台） |
| `stop [target]` | 停止后端 / Workbench / 桌面 / 全部 |

开发模式 channel 固定为 `local`（`ellamaka-local.db`）。

### `scalar-doc.ts` — Scalar API 文档调试

```bash
bun run scripts/scalar-doc.ts
# SCALAR_PORT=8080 SCALAR_API=http://127.0.0.1:3000 bun run scripts/scalar-doc.ts
```

在独立端口提供 Scalar UI，并把 API 请求代理到 ellamaka，支持 "Try it out" 调试。默认 `http://localhost:4100`，代理到 `http://127.0.0.1:4097`。

## 上游合并

### `ellamaka-merge-prep.sh` — 合并前预检报告

```bash
./scripts/ellamaka-merge-prep.sh <target-tag> [--from <commit>] [--json]
```

merge 前分析并预测冲突，输出 4 段报告：上游增量、ellamaka 自定义、merge 模拟（`git merge-tree` 冲突分类）、裁剪缺口。只读分析，不碰工作区。

### `check-cleanup.sh` — 合并后清理上游残留

```bash
./scripts/check-cleanup.sh          # 仅报告
./scripts/check-cleanup.sh --clean # 报告并删除（rm -rf）
```

检查并清理上游 OpenCode merge 后不应保留的残留文件/目录（白名单见 `docs/BRANDING.md §0`）。默认只报告，`--clean` 才删除。

## 共享库

### `lib/version.sh` — 版本解析

被 `build.sh` / `dev.sh` / `release.sh` / `bump-release.sh` 等 source 的共享函数库：

- `resolve_build_version <product> <suffix>` — 解析构建版本（下一 patch + 后缀 + 时间戳）
- `current_version` / `bump_version <patch|minor|major|rc|beta>` — 版本源读取与 bump（package.json 是唯一版本源）
- `sync_min_wopal_cli_version` — 同步 `@wopal/cli-capability-schema` 依赖下界
- `resolve_min_wopal_cli_version` — 解析有效 `MIN_WOPAL_CLI_VERSION`
- `highest_release_tag` / `highest_rc_tag` / `suggest_release_version` — 发布版本建议（stable/beta/rc 渠道）

## 推荐工作流

- **日常开发**：`dev.sh serve` → 改代码 → `build.sh cli` 验证
- **版本准备**：`bump-release.sh --rc`（写入全部 workspace 包 + bun.lock + commit + push）
- **发布**：`release.sh cli` / `release.sh desktop --channel beta`
- **撤回**：`withdraw-release.sh <product>`
- **上游合并**：`ellamaka-merge-prep.sh <tag>` → merge → `check-cleanup.sh --clean` → `bun typecheck && bun test`
