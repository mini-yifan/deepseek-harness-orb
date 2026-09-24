# Agent Note：Windows Computer Use 每监视器坐标

Status: implemented

[English](2026-09-23-windows-computer-use-per-monitor-dpi.md) | 中文

## 问题

Windows 上的 Computer Use 截一块矩形，再把随后的 0–1000 或像素位置变成这块矩形里的 `SendInput` 点。Desktop Host 是 DPI 不感知的 `node.exe`。在这种感知下，`GetWindowRect` 和 `SendInput` 使用被虚拟化的逻辑像素，而 `BitBlt` 使用物理像素。在 200% 的显示器上这两套坐标不一致，从截图上取得的点会错过控件。`GetWindowRect` 还包含不可见的缩放边框。Windows 的选择只取 `GetForegroundWindow`，因此不会像 macOS 那样跳过悬浮球，也不会把打开的菜单并进截图。混合 DPI 布局不是单一缩放：100% 的显示器保持 1:1，200% 的显示器被放大一倍。

## 决策

每次读取矩形或发送指针输入的 Win32 调用，都把当前线程设为 per-monitor v2；v2 被拒绝时退到 per-monitor，并在返回前恢复先前的线程感知。`createProductionWindowsOps` 不改变进程感知。窗口矩形用 `DWMWA_EXTENDED_FRAME_BOUNDS`，该属性失败时才用 `GetWindowRect`。`scale` 是该监视器有效 DPI 除以 96。`movePointer` 在这块物理虚拟屏幕上发送绝对 `SendInput`，若 `GetCursorPos` 不一致，再用 `SetCursorPos` 纠正。

`listScreens` 和 `inspectForeground` 都用 `activeCaptureExcludeWindowIds()` 调用 `selectWindowsObservation`。前台窗口合格时它就是 owner，否则取 z-order 中第一个合格的顶层窗口。合格指可见、未最小化、未 cloaked、不是 overlay hwnd、不是 `WS_EX_TOOLWINDOW`、不是外壳类（`Shell_TrayWnd`、`Shell_SecondaryTrayWnd`、`Progman`、`WorkerW`）、不是系统菜单或组合框下拉，并且每条边至少 `MIN_LAYER0_WINDOW_EDGE` 个物理像素。同一进程的窗口在 owner 链到达该窗口时加入，或在它是相交的 `WS_POPUP` 时加入。另一进程只在相交的 `#32768` 菜单或 `ComboLBox` 时加入。加入的窗口必须位于 owner 的监视器上。截图是这个并集的 `BitBlt`。对 `ApplicationFrameWindow`，用于并集的应用名和进程 id 来自子窗口 `Windows.UI.Core.CoreWindow`。

点击、拖拽、滚动和组合键的时序与 macOS HID 脚本一致：移动后 80 ms，按下与抬起间隔 50 ms，双击间隔 100 ms，拖拽十步，`scroll_level` 的每一档一次滚轮刻度。导航键使用 `KEYEVENTF_EXTENDEDKEY`。`input_text` 在 Ctrl+V 之后等待 80 ms，再恢复字符串剪贴板。`activateApp` 先恢复最小化窗口，在 `SetForegroundWindow` 前后发送 Alt，若该窗口没有成为前台则抛错。

在 Windows 上，`getMediaSourceId()` 是 `window:<HWND>:0`。macOS 后端交给 ScreenCaptureKit 的同一份排除列表就是 HWND 跳过列表。显示亲和性在捕获区间和 HID 区间都保持打开，因为动作后的截图跑在 `withInput` 里面，不会再发一次 capture begin。[Desktop overlay-guard IPC](2026-09-14-desktop-overlay-guard.zh.md) 负责遮蔽。[Windows 悬浮球](../feature/2026-09-22-windows-floating-orb.zh.md) 负责球窗口。

## 考虑过的替代方案

**把进程设为 per-monitor 感知。** Host 进程还在这条线程上跑目录选择器和其他 Win32 调用。改进程会改变那些调用。线程感知只在一次 computer-use 调用期间设置，然后恢复。

**保持 DPI 不感知，再把 `BitBlt` 坐标乘以一个缩放。** 混合 DPI 的虚拟屏幕没有单一缩放。100% 的显示器和 200% 的显示器虚拟化方式不同，虚拟原点也不是物理原点的统一倍数。

**用 `PrintWindow` 或 Windows Graphics Capture 代替屏幕矩形。** macOS 的观察是窗口并集的屏幕矩形，包含压在上面的像素。`PrintWindow` 会漏掉 DWM 合成和 GPU 窗口。对并集做 `BitBlt` 与这种观察一致。

## 后果

0–1000 位置划分的是模型看到的那张截图。同一个比例在 100% 和 200% 的显示器上都映射到物理像素，包括原点为负的窗口。每次调用之后线程回到进程的 DPI 感知。任务栏和桌面不是观察的 owner。另一块监视器上的菜单不会并进截图。未提权进程仍然不能点击提权窗口。Windows 不授予前台时，`activateApp` 会明确失败，而不是报告成功。

## 测试

`windows-foreground.spec.ts` 固定 owner 选择、overlay 与外壳跳过、owner 链和弹出窗口并集、跨进程菜单，以及原点为负的 100%、200%、150% 三块监视器。`windows.spec.ts` 通过注入的操作固定点击、拖拽、滚动、扩展键和剪贴板顺序，不发送真实输入。在一台 `EnumDisplayMonitors` 列出 2560×1600、192 DPI 主屏和原点 `(0, -1080)`、1920×1080、96 DPI 显示器的机器上，两块屏的指针中心都落在目标像素，线程感知回到 unaware。那次检查没有接上第三块显示器。
