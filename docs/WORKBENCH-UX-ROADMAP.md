# Ellamaka Workbench 用户体验优化路线图 (UX Optimization Roadmap)

> **状态**：体验规划与设计路线图文档  
> **创建时间**：2026-07-21  
> **关联文档**：[WORKBENCH.md](file:///Volumes/U500G/coding/wopal-workspace/projects/ellamaka/docs/WORKBENCH.md)（核心架构规范）、[AGENTS.md](file:///Volumes/U500G/coding/wopal-workspace/projects/ellamaka/packages/ellamaka-app/AGENTS.md)（开发规则与边界）

---

## 1. 背景与成果复盘

Ellamaka Workbench 作为多空间、多面板的现代 AI Coding 环境，在 2026-07-21 完成了一系列重要的稳定性打磨与用户体验修复：

### 1.1 已完成的体验修复与优化

1. **状态栏双边框缺陷修复 (Statusbar Diagnostics Border Fix)**：
   - 彻底解决了 Diagnostics Popover 底部边框与列表下边框在 `:last-child` 失效后产生的双重平行横线问题，将结构解耦为列表 `divide-y` 与固定 `Footer`，提升了弹窗视觉精致度。
2. **状态栏层级链精简 (Statusbar Left Segments Simplification)**：
   - 去除了状态栏左下角冗余的空间名称和长工作路径，精简为仅包含核心的激活面板索引与会话标题（如 `P1/2 / 会话标题`），降低了底栏的视觉噪声。
3. **面板空状态编号物理位置对齐 (Panel Index Numbering)**：
   - 彻底重构了空面板标题编号的生成算法：从原本“截取历史创建自增序列 ID（导致删除/重加后出现 `#1 | #3` 错位断层）”修改为“基于界面自左向右物理显示位置（`#1 | #2 | #3`）”，确保编号与视觉排列绝对一致。
4. **Canvas 终端渲染与 DPR 缝隙消除 (Non-integral DPR Fix)**：
   - 修复了非整数 Device Pixel Ratio（如 Retina 缩放或 Electron Zoom 110%）下 Canvas 终端出现物理网格缝隙纹理的问题。
5. **中文输入法预编辑定位 (IME Preedit Positioning)**：
   - 修复了 Terminal / TUI 隐藏 textarea 与系统中文拼音预编辑弹窗的光标随动定位与样式。
6. **GPU 合成图层提升 (GPU Layer Promotion)**：
   - 将面板主视图区域提升到 GPU 合成图层（`transform: translateZ(0)`），显著提升了多面板拖拽与视图切换时的帧率表现。

---

## 2. Workbench UX 核心设计原则

在推进后续用户体验优化时，必须严格遵循以下硬性原则（参见 [WORKBENCH.md](file:///Volumes/U500G/coding/wopal-workspace/projects/ellamaka/docs/WORKBENCH.md)）：

1. **零侵入原则 (Zero Upstream Mutation)**：
   - 所有 Workbench UI 代码独立封包于 `packages/ellamaka-app`，绝不编辑 `packages/app` 上游文件。
2. **唯一所有权原则 (Single State Owner)**：
   - 布局由 `WorkbenchStore` 唯一持久化；服务端 Session Projection 属于内存只读投影；PTY 物理存活事实属于 Sidecar。UI 绝不乐观伪造数据。
3. **无损保活原则 (Space & Terminal Keep-Alive)**：
   - 隐藏的 Space Tab 使用 `visibility: hidden; inert` 保留 DOM；视图切换与 Split Terminal 折叠**绝不销毁后端 PTY 进程**与 WebSocket Subscriber。
4. **防爆与受控隔离原则 (Diagnostics & Input Lock)**：
   - 局部非阻塞错误绝不抛出至面板 ErrorBoundary 导致组件卸载，统一进入居中诊断中心；物理断连时通过 Shell 顶层模态遮罩隔离输入。

---

## 3. 体验优化建议与演进路线

基于现有的系统架构，后续用户体验优化分为以下 **四个核心维度** 逐步推进：

---

### 方向一：面板排版与快捷操控体验 (Layout & Ergonomics)

#### 1. 面板快捷专注模式 (Focus / Maximize Mode)
- **场景**：当工作区打开了 3 个面板时，用户希望临时专注调试某个面板（如全屏看 Chat 或 Terminal）。
- **设计方案**：
  - 双击面板 Header 空白区域，或按下快捷键（`Cmd+Option+F`），将当前 Panel 临时放大覆盖整个 `Panel Workspace`。
  - 顶部或 Header 呈现浮动提示 `按 Esc 或再次双击退出专注模式`。
  - 再次触发时无缝恢复原来的多面板 Flex 比例，期间其余面板在后台保活不卸载。

#### 2. 一键均分面板宽度 (Equalize Panel Widths)
- **场景**：用户手动拖拽调宽某个面板后，希望快速恢复默认的均分状态。
- **设计方案**：
  - 双击面板之间的分隔线（Resize Handle），或在面板 Header 右键菜单中提供 `均分面板宽度 (Reset Widths)`，一键重置当前 Space 内所有面板的宽度为 `1:1:1`。

#### 3. 键盘导航与 Panel 焦点高亮 (Keyboard Navigation & Focus)
- **场景**：无需鼠标即可在多个面板与空间之间高速切换。
- **设计方案**：
  - `Cmd+1` / `Cmd+2` / `Cmd+3`：快速聚焦并激活 Panel 1 / 2 / 3。
  - `Cmd+Shift+[` / `Cmd+Shift+]`：在顶栏已打开的 Space Tab 之间左右轮转。
  - 聚焦面板顶部的蓝条/高亮边框增加清晰但微弱的光晕动画，方便用户一眼识别当前键盘输入焦点所在。

---

### 方向二：终端与 Chat 深度协同 (Terminal & Chat Synergy)

#### 1. Split Terminal 动态任务/运行状态感知
- **场景**：辅助终端在底部收起（Collapsed）或非激活时，终端内部运行的程序（如 `bun test` / `build`）可能报错或执行完毕，用户无法及时感知。
- **设计方案**：
  - 当 Split Terminal 内部 PTY 有命令输出或处于长任务状态时，Header 右侧的终端图标在黄色/绿色基础上传递状态：
    - **长任务运行中**：图标呈现呼吸脉动动画。
    - **命令执行完毕/成功**：图标短暂闪烁绿色圆圈。
    - **进程非零退出/报错**：图标显示醒目的警告圆点。

#### 2. Chat 代码块一键发送至 Split Terminal 运行
- **场景**：在 Chat 视图中，AI 生成了终端命令代码块（如 `bun run dev` 或 `git checkout -b feature`），用户需要手动复制粘贴到终端。
- **设计方案**：
  - 在 Chat 视图的代码块右上角增加一个 `在面板终端运行 (Run in Terminal)` 快捷按钮。
  - 点击后若 Split Terminal 未展开则自动展开，并将命令字符串安全写入关联面板的 Split Terminal PTY 执行。

---

### 方向三：会话管理与全局快捷搜索 (Session Navigation)

#### 1. 工作台快速命令与会话搜索面板 (Quick Switcher / Command Palette)
- **场景**：已打开多个 Space、数十个 Session 时，在左侧侧边栏目录树中逐层展开查找较为繁琐。
- **设计方案**：
  - 按下全局快捷键 `Cmd+K` 或 `Cmd+P`，弹框调出工作台快捷命令面板。
  - 支持模糊搜索当前 Space 及全局的所有 Session 标题与物理路径。
  - 选中搜索结果后，系统自动执行跨空间 Tab 切换与面板高亮定位；若会话未打开，则自动在合适的 Panel 装载。

#### 2. 面板间会话拖拽互换与快捷替换
- **场景**：用户希望调整两个面板绑定的 Session 位置。
- **设计方案**：
  - 支持把左侧 Session 树中的节点或一个面板的 Header 拖入另一个已绑定的面板。
  - 触发模态询问或快捷选项：`替换当前面板会话` 或 `互换面板会话位置`，避免误操作。

---

### 方向四：诊断中心与系统反馈增强 (Diagnostics & System Feedback)

#### 1. 静默重连与恢复 Toast 智能感知
- **场景**：网络短时间抖动后，系统自动从 `degraded` 切回 `online`。
- **设计方案**：
  - 当 `runtime.status` 恢复 `online` 时，居中诊断中心自动弹出微缩的“连接已恢复，数据已同步”静默 Toast 并于 3 秒后淡出。
  - 若有重试失败的项，Popover 内直接提供“查看详细日志”或“一键修复”引导。

---

## 4. 实施与验收规范

每个体验优化子项在落地实施时，必须严格执行以下验证链：

1. **红绿测试 (TDD)**：修改前编写或更新单元测试，验证纯函数与逻辑行为。
2. **静态契约门控**：在 `packages/ellamaka-app` 目录下运行 `bun run check:workbench-boundaries`，确保 zero tracked debt。
3. **类型检查**：运行 `bun run typecheck`（`tsgo -b`），确保零 TypeScript 类型错误。
4. **单元测试全量验证**：运行 `bun run test:unit --force-exit`，确保既有测试无回归。
5. **用户验证**：在未得到用户明确验证认可前，不执行 Git 提交。
