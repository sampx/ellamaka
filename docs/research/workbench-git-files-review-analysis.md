# Ellamaka Workbench Git 状态、文件树与会话审查架构研究报告

## 摘要

本报告针对 **Ellamaka Workbench** 项目在 Git 状态展示、文件树探查、空间级多 Repo 嵌套架构兼容性，以及 Session 闭环内部代码审查（Code Review）与批注系统的可行性与架构进行了深入调研与系统分析。

调研明确了 Ellamaka 现有的前端组件能力及其边界，剖析了在 Wopal 空间多仓库嵌套架构下的底层缺陷，纠正了脱离真实 DOM 结构的 UI 假设，并提出了基于当前 `Session.tsx` 页面结构的会话内代码审查与批注闭环架构方案。

---

## 1. 现有前端组件与能力现状

通过对 `projects/ellamaka/packages/app/src` 的源码分析，Ellamaka 已经具备了良好的 UI 基础与底层渲染组件：

### 1.1 文件树组件 (`FileTree`)
* **源文件**: `packages/app/src/components/file-tree.tsx`
* **现有能力**:
  - 支持多层级目录的树状折叠/展开与状态记忆。
  - 支持 `kinds` 映射表，能够根据 Git 状态（`A` 新增 / `M` 修改 / `D` 删除）自动高亮标注节点颜色与状态字母。
  - 支持 `all`（全量文件）与 `changes`（仅变动文件）的视图模式切换。
  - 基于 `@thisbeyond/solid-dnd` 支持文件与目录的拖拽（Drag & Drop）操作。

### 1.2 Git 差异对比组件 (`SessionReview` / `SessionReviewTab`)
* **源文件**: `packages/app/src/pages/session/review-tab.tsx` / `@opencode-ai/ui/session-review`
* **现有能力**:
  - 支持解析并展示 VCS/Git 补丁差异。
  - 支持 `unified`（单栏统一）与 `split`（双栏并排对比）两种视图格式切换。
  - 具备代码差异高亮、行号锚定以及行级批注（Line Comments）互动能力。

### 1.3 多文件选项卡组件 (`FileTabs`)
* **源文件**: `packages/app/src/pages/session/file-tabs.tsx`
* **现有能力**:
  - 基于 `file.pathFromTab` 呈现多文件选项卡，支持标签页拖拽重排与切换。
  - 接入了代码阅读器，支持语法高亮、代码滚动位置持久化与选中行高亮。

### 1.4 行级选区与批注存储机制 (`useComments`)
* **源文件**: `packages/app/src/context/comments.tsx`
* **工作机制**:
  1. 用户在代码或 Diff 视图中划选代码行，产生 `SelectedLineRange` 选区对象。
  2. 弹出行内输入框，用户提交批注内容（`comment`）。
* **存储位置与载体**:
  - **完全不修改磁盘上的源代码文件**。
  - 采用前端持久化库 `Persist.scoped(dir, id, "comments")`，保存在**客户端浏览器的 IndexedDB / LocalStorage 缓存**中。
  - 数据结构记录了 `id`（UUID）、`file`（文件路径）、`selection`（起始行 `start` 与结束行 `end`）以及 `comment`（批注内容）。

---

## 2. Wopal 空间级多 Repo 架构兼容性与后端缺陷

### 2.1 Wopal 空间多仓库特征
在 `wopal-workspace` 空间架构中：
- **空间根仓库 (Space Root)**：位于空间根目录（如 `space/wopal-workspace` 分支），管理 `.wopal-space/` 与空间级规则。
- **嵌套项目仓库 (Project Repos)**：位于 `projects/*` 目录下（如 `projects/ellamaka`, `projects/gesp`, `projects/space-flow` 等），每一个子项目都是独立且自治的 Git 仓库。

### 2.2 后端 VCS 服务与 `vcsQuery` 的现实缺陷
分析 `packages/opencode/src/project/vcs.ts` 和 `packages/app/src/pages/session.tsx` (L485) 发现：
- 前端 `reviewDiffs()` 底层调用的 `vcsQuery` 仅针对单一工作目录（`cwd`）执行 `git status` 或 `git diff`。
- **缺陷**：在多 Repo 嵌套空间中，如果单个 AI 会话同时修改了位于不同子项目 Repo 中的文件，当前的后端 `vcs` 无法跨多个 Repo 归集修改，会导致代码改动的漏报与错报。

---

## 3. Ellamaka Workbench 真实界面 DOM & 路由结构剖析

为避免脱离实际代码的抽象套用，本调研重新对 `app.tsx` 和 `layout.tsx` 的 DOM 结构进行了摸排：

### 3.1 真实 DOM 层级结构
```
[最外层 Layout (layout.tsx)]
 ├── 1. 顶部 Titlebar (44px, 包含 Logo、空间/项目下拉切换器)
 └── 2. 主 Flex 容器
      ├── 2.1 最左侧 sidebar-rail (64px 宽度图标导航轨)
      ├── 2.2 左侧 SidebarPanel (可伸缩面板，装载工作区与会话列表)
      └── 2.3 路由容器 {props.children}
           └── 路由 /:dir/session/:id 对应装载的【Session 页面 (session.tsx)】
                ├── SessionHeader (会话头部)
                ├── SessionSidePanel (会话侧边栏)
                ├── MessageTimeline (聊天对话历史)
                ├── TerminalPanel (终端面板)
                └── PromptInput (底部提示词输入框)
```

### 3.2 界面架构结论
目前的 Ellamaka Workbench 结构中，`{props.children}` 区域在主要使用路径下**完全由 `Session` 页面驱动**。系统中目前并不存在一个独立于 Session 之外的“通用主工作区”。

---

## 4. Session 内部文件审查与批注闭环架构方案

基于真实 Session 页面架构，用户提出了在 Session Panel 内部集成代码审查与批注的痛点与需求。

### 4.1 方案设计：Session 内部 Header 视角切换
在 `Session.tsx` 页面内部，保持底部的 `PromptInput` 固定，在顶部 Header 或侧栏增加视图切换：

```
+-----------------------------------------------------------------------------------+
| Session Panel Header                                                              |
| 会话标题: "重构文件树组件"  |  切换菜单: [ 💬 对话 (Chat)  |  🔍 审查 (Review) ]  |
+-----------------------------------------------------------------------------------+
| Panel Body (当前在 [🔍 审查 (Review)] 视角)                                       |
|                                                                                   |
| ▾ 📂 本会话受影响的文件清单 (2 files changed)                                       |
|   ├── 📄 packages/app/src/components/file-tree.tsx (+5, -2)                       |
|   └── 📄 packages/app/src/pages/layout.tsx (+12, -0)                             |
| --------------------------------------------------------------------------------- |
| [ 🔍 Diff 对比视图 (SessionReviewTab) ]                                            |
|                                                                                   |
| 194  const file = useFile()                                                       |
| 195+ const spaceVcs = useSpaceVcs()                                               |
| 196+ // 💬 用户划线批注: "这里的 hooks 传入参数好像漏掉了 typescript 类型定义"      |
| 197  const level = props.level ?? 0                                               |
|                                                                                   |
+-----------------------------------------------------------------------------------+
| Panel Footer (当前 Session Panel 底部固定的 Prompt 输入框)                           |
| 📎 已附加上下文: [ 📄 file-tree.tsx:L195-196 - "这里的 hooks 传入参数好像漏掉..." ]   |
| 💬 [ 按照上面的审查批注，帮我修复类型定义                     ] [ ⬆ 发送给 AI ] |
+-----------------------------------------------------------------------------------+
```

### 4.2 交互闭环三步骤
1. **视图切换**：用户在 Session 头部将视角从 `对话` 切至 `审查`，消息流区域替换为 `SessionReviewTab`。
2. **划线批注与 Context 联动**：在 Diff 差异行划选并提交批注时，触发：
   ```ts
   onLineComment={(comment) => addCommentToContext({ ...comment, origin: "review" })}
   ```
   批注内容（包含文件路径、选区代码片段预览与批注文本）自动注入到当前 Session 运行中的 `prompt.context` 中。
3. **闭环修复**：用户切回 `对话` 视角或直接在底部输入框按下发送，AI Agent 读取批注上下文并针对特定行号进行第二轮精细修复。

---

## 5. 重构与实施建议

1. **后端扩展 (VCS 模块)**：
   在 `packages/opencode/src/project/vcs.ts` 中增加空间多 Repo 发现与跨仓库 Diff 聚合计算逻辑，使得 `reviewDiffs` 能准确收集当前 Session 在多个嵌套仓库中所做的代码修改。
2. **前端视图重构 (Session 页面)**：
   在 `SessionHeader` 中增加视角控制状态，将 `SessionReviewTab` 作为 `MessageTimeline` 的同级可切换视图嵌入 `session.tsx`。
3. **保持 Prompt 联动**：
   复用 `addCommentToContext` 逻辑，确保会话内审查的批注能平滑送达 Prompt 触发 AI 迭代。

---
*报告生成时间: 2026-07-30*
