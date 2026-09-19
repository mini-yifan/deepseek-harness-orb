# Agent Note: 桌面 overlay-guard IPC

Status: implemented

[English](2026-09-14-desktop-overlay-guard.md) | 中文

## 问题

Computer Use 的捕获与 HID 在 Desktop Host 子进程里运行。macOS 悬浮 overlay 是始终置顶的 Electron panel（球和展开后的对话共用这一扇窗）。两扇 Desktop 窗口常开 `contentProtection`，会让 Agent 看不见 Harness UI，也会让球从所有其他截屏里消失。常开点击穿透会抢走用户的输入框。Host Node IPC 只接受 `ready` / `fatal` / `shutdown`；未知事件会杀掉子进程。overlay 渲染进程 IPC 看不见从主窗口启动的 Computer Use 会话。macOS 15.4+ 上 `/usr/sbin/screencapture` 走 ScreenCaptureKit，会忽略 `NSWindowSharingNone`（`contentProtection`），因此捕获期间的保护位无法把 overlay 从帧缓冲区里拿掉。

## 决策

Desktop Host 协议版本是 7。管道 `FRAME_MAGIC` 仍是 `0x44534833`，因为字节管道布局没有变。Node IPC 承载带确认的 `overlay-guard`（`begin` | `end`，`mode: capture` | `input`）与携带 `excludeWindowIds` 的 `overlay-guard-ack`，以及带确认的 `observation-frame`（`bounds` 或 `null`）与 `observation-frame-ack`。Electron 在 `mode` 为 `input` 时应用 HID 点击穿透，等待 `OVERLAY_GUARD_INPUT_APPLY_MS`（80）让 WindowServer 提交命中测试，然后确认，即使没有 overlay 也确认（`excludeWindowIds: []`）。捕获 begin 上报可见 overlay 窗口（悬浮球，仅在显示时的划词工具条，以及仅在显示时的观察框彩带）的 CGWindowID。隐藏的 overlay 窗口不列入：ScreenCaptureKit 的 `onScreenWindowsOnly` 看不见它们，缺少的 exclude id 会使捕获失败。HID 返回后 Host 等待 `OVERLAY_GUARD_INPUT_DRAIN_MS`（80），然后在 `finally` 里只为最外层 input 区间发送 `end`。嵌套的 `withInput` 共用该 input 区间。`withCapture` 内的嵌套 `withCapture` 共用外层捕获 exclude id。`withInput` 内的嵌套 `withCapture` 仍发送 capture begin/end，好让 `setObservationFrame` 显示彩带后刷新 exclude id，且不切换点击穿透。Electron 在 Host 退出时恢复 overlay chrome 并隐藏观察框。确认等待是 `OVERLAY_GUARD_ACK_TIMEOUT_MS`（1000）。[Computer Use 观察框彩带](../feature/2026-09-19-computer-use-observation-frame.zh.md) 拥有该彩带。

主窗口从不设置 `contentProtection` 或 `ignoreMouseEvents`。overlay 默认保持画出、可点。捕获不设置 `contentProtection`。`input` 模式只在 input 计数从 0 变为 1 时对整扇 overlay 窗设置 `setIgnoreMouseEvents(true, { forward: false })` 并 `blur()`，并隐藏划词工具条而不是给第二扇窗做点击穿透。input 保持期间嵌套的捕获 IPC 不再额外 blur。HID 工具与 `open_app` 通过 `withGuiTurn` 把该 input 遮蔽持续到 recapture；[Computer Use 右键菜单观察](../bug-fix/2026-09-16-computer-use-context-menu-observation.zh.md) 拥有这一回合。

当 `excludeWindowIds` 非空时，Computer Use 捕获运行 Darwin 的 ScreenCaptureKit helper，而不是 `/usr/sbin/screencapture`。可分享内容里缺少 overlay 窗口会使捕获失败；不会回退到 `screencapture`。id 列表为空的 CLI 和其他宿主仍用 `screencapture`。[Computer Use 应用窗口观察](../feature/2026-09-16-computer-use-app-window-observation.zh.md) 拥有始终区域观察捕获。[Computer Use 瞬时窗口观察](../feature/2026-09-16-computer-use-transient-window-observation.zh.md) 拥有 `--region=` 与 display `excludingWindows` 再裁切。helper 仍实现 `--window=` / `SCContentFilter(desktopIndependentWindow:)`；观察不调用它。

Computer Use 保持对 Electron 无感知：`wrapDesktopBackend` 把 `listScreens`、`capture` 与 inspect 包进 `withCapture`（把 id 存给 macOS 后端），把 HID、`openApp` 与 `withGuiTurn` 包进 `withInput`；`listScreens` 之后等待 `setObservationFrame`。`listApps`、`openInBrowser` 与 `openInFinder` 不包装。[Computer Use 焦点窗口观察](../feature/2026-09-16-computer-use-focused-window-observation.zh.md) 拥有把 `listScreens` 包进去。生产 `apply` 使用 `ctx.get('computerUseOverlayGuard')`，没有该服务时跳过包装。Desktop 拷贝已构建的 `lib/index.js` extra，并拒绝缺少该 wrap 的包。`start:desktop --skip-build` 仍会重建 Desktop Host、Electron 壳和这个实验包，`withCapture` 不能在没有窗口 id 的情况下调用 `run()`。Desktop Host overlay YAML 插入 `computer-use-overlay-guard`，由它提供该服务，且不得导入该实验包。只有 Computer Use 把该可选 Context 键声明合并进去，这样 Host 类型检查不会撞上两份 `ComputerUseOverlayGuard` 类型。Index 与 YAML 插件共享同一份 overlay-guard 模块实例，待确认表不会拆到两份 bundle 里。见 [桌面悬浮球](../feature/2026-09-14-desktop-floating-orb.zh.md)。

## 考虑过的替代方案

**两扇窗口常开 `contentProtection`。** 那会让 Agent 看不见 Harness UI，也会让球在用户截屏和会议捕获里始终消失。

**捕获期间隐藏或淡出 overlay。** 用户会看到球闪一下消失。

**只在捕获区间开 `contentProtection`。** macOS 15.4+ 上 ScreenCaptureKit 的显示捕获仍会包含该窗口，受保护窗口还可能从 `SCShareableContent.windows` 消失，因而无法按 id 排除。

**私有 `CGSSetWindowCaptureExcludeShape`。** 那能保住 `/usr/sbin/screencapture`，但不是公开 API。

**overlay 渲染进程 IPC。** 主窗口上的 Computer Use 不会遮蔽球。

**由 Host 发起 Fetch 管道。** 管道只承载 Electron 发起的 Fetch。Node IPC 已经承载控制消息。截图像素放不进 overlay-guard 确认。

**包装全部 `plugin.ts` 的 execute。** 首帧捕获走 `agent/pre-step`，不是 HID。HID 工具用 `withGuiTurn` 把 input 遮蔽持续到 recapture，由 [Computer Use 右键菜单观察](../bug-fix/2026-09-16-computer-use-context-menu-observation.zh.md) 拥有。

## 后果

混用的 Electron/Host 壳在 `ready` 时失败，而不是第一次遮蔽时失败。丢失的 `end` 在 Host 子进程退出时恢复。并发 Computer Use 会话共享 overlay 引用计数。键盘焦点仍可能在 `input` 区间之外落到 overlay；`open_app` 与 HID 走 `withInput`，overlay 会在激活或投递事件前 `blur()`。Web 与 CLI 的 Computer Use 保持不遮蔽。Darwin Desktop extra 在已编译 helper 时包含 `lib/macos-sck-capture`。

## 测试

Electron 测试钉住捕获 begin 时默认 `contentProtection === false`、捕获确认上可见 overlay 的 `getMediaSourceId` 窗口 id（隐藏的工具条与隐藏的观察框不列入）、input begin 的 `ignoreMouseEvents({ forward: false })` 并隐藏工具条、observation-frame 的显示/隐藏以及始终点击穿透、input 保持期间嵌套捕获不再额外 blur、异步 overlay-guard 回调只在 Promise 完成后确认、Host 停止时恢复并隐藏观察框、overlay-guard 与 observation-frame IPC 不是 fatal，以及协议 4 的 ready 被拒绝。Desktop Host 测试钉住 overlay YAML 插入、没有 sender 时直通、begin 确认的窗口 id 到达 `withCapture`、抛错后恢复、中止后恢复、确认超时、`withInput` 在 `end` 前排空、嵌套 `withInput` 加 `withCapture` 刷新捕获 exclude id、嵌套 `withCapture` 只发一次 capture begin/end、observation-frame 的发送/确认/超时/中止，以及 `apply` 加上已安装 transport。Computer Use 测试钉住 `wrapDesktopBackend` 对 capture、HID、被遮蔽的 `listScreens` 与 `openApp`、以及不包装的 `listApps` / `openInBrowser` / `openInFinder` 的区别、`listScreens` 之后的 `setObservationFrame`、`turn/end` 清除、`withGuiTurn` 嵌在 `withInput` 里、转发的 exclude id、抛错后恢复、子 context 上的 `apply` 包装、设置 id 时的 helper `--region=` argv、不回退到 `screencapture`，以及缺少 wrap 时 extra 拷贝被拒绝。
