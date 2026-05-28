# Wopal Home Directory Migration

将 Ellamaka 的全局配置从 XDG 分散布局迁移到 `~/.wopal` 统一目录。

## 迁移前后对比

### 目录映射

| 用途 | 迁移前（XDG） | 迁移后 |
|------|---------------|--------|
| 数据（DB、日志） | `~/.local/share/opencode/` | `~/.wopal/ellamaka/data/` |
| 缓存 | `~/.cache/opencode/` | `~/.wopal/ellamaka/cache/` |
| 二进制 | `~/.cache/opencode/bin/` | `~/.wopal/ellamaka/cache/bin/` |
| 全局配置 | `~/.config/opencode/` | `~/.wopal/ellamaka/config/` |
| 运行时状态 | `~/.local/state/opencode/` | `~/.wopal/ellamaka/state/` |
| 用户级配置目录 | `~/.opencode/` | `~/.wopal/` |
| 系统托管配置 (macOS) | `/Library/Application Support/opencode` | `/Library/Application Support/wopal` |
| 系统托管配置 (Linux) | `/etc/opencode` | `/etc/wopal` |
| macOS plist domain | `ai.opencode.managed` | `ai.wopal.managed` |

### 环境变量

| 变量 | 用途 |
|------|------|
| `WOPAL_HOME` | 覆盖 `~/.wopal` 根目录（测试隔离用） |

## ~/.wopal 目录结构

```
~/.wopal/
├── ellamaka/
│   ├── data/                    # 持久数据
│   │   ├── opencode.db          # SQLite 数据库（会话、消息、快照）
│   │   └── log/                 # 运行日志
│   ├── cache/                   # 可清除的缓存
│   │   ├── bin/                 # 二进制文件（curl 安装方式）
│   │   └── version              # 缓存版本号（版本变更时自动清空缓存）
│   ├── config/                  # 全局配置（对所有项目生效）
│   │   ├── opencode.json        # 全局配置文件
│   │   ├── opencode.jsonc       # 全局配置文件（支持注释）
│   │   └── tui.json             # TUI 配置
│   └── state/                   # 运行时状态
├── agents/                  # 用户级 Agent 定义（*.md）
├── commands/                # 用户级命令定义（*.md）
├── plugins/                 # 用户级插件（*.ts / *.js）
└── themes/                  # 用户级主题（*.json）
```

### 配置优先级

配置从多个层级加载，后加载的覆盖先加载的：

1. **全局配置** — `~/.wopal/ellamaka/config/opencode.json`
2. **项目级配置** — 从项目目录向上查找 `.opencode/opencode.json`
3. **用户级 override** — `~/.wopal/` 下的 agents、commands、plugins、themes
4. **`OPENCODE_CONFIG_DIR`** — 环境变量指定的额外配置目录

> `~/.wopal/` 兼具两个角色：子目录 `ellamaka/` 存放引擎的独立运行时数据及配置；
> 根目录下的 `agents/`、`commands/`、`plugins/`、`themes/` 作为用户级配置 override 层，
> 对所有项目生效（等价于迁移前的 `~/.opencode/`）。

### 未改动

- **项目级 `.opencode/` 目录** — 保持不变，这是面向所有用户的项目配置约定
- **`opencode.jsonc` 配置文件名** — 保持不变
- **外部 URL**（`opencode.ai`、`api.opencode.ai`）— 保持不变

## 变更文件清单

### 核心路径定义

| 文件 | 变更 |
|------|------|
| `packages/opencode/src/global/index.ts` | 移除 `xdg-basedir` 依赖，改用 `~/.wopal` 子目录 |
| `packages/opencode/src/config/paths.ts` | Home 目录配置查找 `.opencode` → `.wopal` |
| `packages/opencode/src/config/config.ts` | 系统托管配置路径 + macOS plist domain |
| `packages/opencode/package.json` | 移除 `xdg-basedir` 依赖 |

### 安装 / 卸载

| 文件 | 变更 |
|------|------|
| `packages/opencode/src/installation/index.ts` | 二进制路径检测 `.opencode/bin` → `.wopal/bin` |
| `packages/opencode/src/cli/cmd/uninstall.ts` | Shell 配置清理中的路径引用 |
| `scripts/build.sh` | 默认安装目录 `~/.opencode/bin` → `~/.wopal/bin` |

### 测试隔离

| 文件 | 变更 |
|------|------|
| `packages/opencode/test/preload.ts` | 4 个 `XDG_*_HOME` → 1 个 `WOPAL_HOME` |
| `packages/app/script/e2e-local.ts` | 同上 |
| `packages/app/e2e/backend.ts` | 同上 |

## 已有用户迁移

如果之前已经使用过 OpenCode 产生了数据，需要手动迁移：

```bash
mkdir -p ~/.wopal/ellamaka
mv ~/.local/share/opencode ~/.wopal/ellamaka/data
mv ~/.cache/opencode ~/.wopal/ellamaka/cache
mv ~/.config/opencode ~/.wopal/ellamaka/config
mv ~/.local/state/opencode ~/.wopal/ellamaka/state
```
