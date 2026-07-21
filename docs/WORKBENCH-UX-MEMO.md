# Workbench 体验优化备忘录 (UX Suggestions Memo)

> 提示：本文档为临时体验优化建议备忘录，仅供后续讨论与参考。

---

## 1. 面板排版与操控 (Layout & Ergonomics)

- **面板专注/最大化模式 (Focus Mode)**：双击面板 Header 或按 `Cmd+Option+F` 临时最大化当前面板，按 `Esc` 或再次触发还原。
- **一键均分面板宽度 (Equalize Widths)**：双击面板分隔线一键恢复多面板等宽 (`1:1:1`) 分割。
- **键盘快捷导航 (Keyboard Navigation)**：`Cmd+1` / `Cmd+2` / `Cmd+3` 快速聚焦面板 1/2/3；`Cmd+Shift+[` / `]` 轮转空间 Tab。

---

## 2. 终端与 Chat 协同 (Terminal & Chat Synergy)

- **Split Terminal 后台状态感知**：辅助终端在收起/非激活时，终端内部长任务（如 build/test）运行中显示微脉动动画，报错/完成时提供明显图标指示。
- **Chat 代码块一键发送至终端**：Chat 视图代码块右上角增加“在终端运行”按钮，自动展开 Split Terminal 并注入执行。

---

## 3. 会话导航与搜索 (Session Navigation)

- **全局会话搜索面板 (Quick Switcher, `Cmd+K`)**：按 `Cmd+K` 或 `Cmd+P` 调出搜索框，支持跨空间模糊搜索 Session 并自动跳转/定位。
- **面板会话拖拽互换/替换**：支持拖拽会话到已绑定面板以进行快捷替换或位置互换。

---

## 4. 系统诊断与反馈 (Diagnostics)

- **重连恢复静默 Toast**：网络恢复后在居中诊断区自动提示“连接已恢复”并于 3 秒内自动淡出。
