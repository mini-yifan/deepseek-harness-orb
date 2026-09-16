# Agent Note: Computer Use 右键菜单观察

Status: implemented

[English](2026-09-16-computer-use-context-menu-observation.md) | 中文

## 问题

[Computer Use 瞬时窗口观察](../feature/2026-09-16-computer-use-transient-window-observation.zh.md) 把 layer 101 的 NSPopUpButton 菜单并进最前窗口截图。微信、Electron、Chromium 和 Qt 的右键菜单通常是另一扇 layer 0 或 25 的 CGWindow，而且常常属于 Helper 进程。`inspectForeground` 丢掉这些窗口，捕获仍停在所有者 backing store，模型看不见打开的菜单。

`observeDesktop` 在 `postActionWaitMs` 之前列出窗口，再按那份过期的 `ScreenInfo` 截屏。overlay-guard 在 HID 的 `withInput` 与 recapture 的 `withCapture` 之间恢复始终置顶的球，自定义菜单会被关掉。

## 决策

[瞬时窗口观察](../feature/2026-09-16-computer-use-transient-window-observation.zh.md) 仍拥有 `transientWindowIds` 非空时的区域捕获。本笔记拥有哪些窗口并入该并集、inspect 何时运行，以及 HID 加 recapture 期间的 overlay 点击穿透。

匹配仍从跳过 overlay 后的 layer-0 所有者开始。同一 PID、任意非 chrome layer（含 0 与 25）的窗口，在与所有者外扩 48pt 后相交时并入。另一 PID 在 `kCGWindowOwnerName` 相同、或一方是另一方加空格（`WeChat` / `WeChat Helper (Renderer)`）且同样相交时并入。无亲缘关系的 PID 仍只在 layer 101 且带该 pad 时并入。Dock 与菜单栏 layer 20、24 仍是 chrome；layer 25 不是。

`observeDesktop` 先等待 `postActionWaitMs`，再 `listScreens` / inspect / capture。

HID 工具与 `open_app` 用 `DesktopBackend.withGuiTurn` 包住动作和 recapture。`wrapDesktopBackend` 把它映射到 overlay-guard 的 `withInput`，内层 HID 的 `withInput` 不会在截图返回前恢复球。Desktop Host 对嵌套的 `withInput` / `withCapture` 做引用计数，一回合只发一次 input begin/end；该回合内的捕获复用 input begin 的 `excludeWindowIds`，不切换 overlay 点击穿透。`wait`、`long_wait`、`screenshot` 与 `list_apps` 不调用 `withGuiTurn`。观察仍是一扇窗口并上它的菜单；没有整桌面回退。

## 考虑过的替代方案

**始终裁所有者的显示器矩形。** 伸到该矩形外的菜单仍会被裁掉，重叠的其他应用会进入每一次截图。

**把屏幕上每一扇 layer-0 窗口都当瞬时窗口。** 无关的重叠应用会并进每一张截图。

**整个 Computer Use 会话常开 overlay 点击穿透。** 那会挡住球上的停止控件。

**包装全部 `plugin.ts` execute，包括首帧 `agent/pre-step`。** 首帧附加不是 HID；在那里保持 input 遮蔽没有必要。

## 影响

与所有者相交的同应用调色板会把截图变大。根本不出现在 `CGWindowList` 里的菜单仍然看不见。一次 HID 工具加上等待和捕获期间，overlay 停止不可点。

## 测试

包测试钉住 inspect JXA 的 `relatedOwner`、layer 0 / Helper 名称匹配、chrome layer 为 20/24 而不含 25、`observeDesktop` 在 `listScreens` 之前 delay、`withGuiTurn` 经 `withInput` 且内层 HID 加 capture、HID 工具调用 `withGuiTurn`，以及 `wait` / `long_wait` / `screenshot` / `list_apps` 跳过它。Desktop Host 测试钉住嵌套 `withInput` 加 `withCapture` 只发一次 input begin/end。Electron 测试钉住 input 保持期间 overlay 不再额外 blur。
