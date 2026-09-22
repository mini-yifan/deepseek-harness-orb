# Agent Note: Desktop overlay click keeps the front app

Status: implemented

[English](2026-09-22-desktop-overlay-click-keeps-front-app.md) | 中文

## 问题

点击 macOS 悬浮球面板（提问选项、提交，或其他按钮）会激活 DeepSeek Harness。`app` 的 `activate` 随后调用 `focusPrimaryWindow()`，对主窗口 `show` 并 `focus`。在 macOS 上这会把主窗口排到 Computer Use 正在操作的应用前面。下一轮观察会跳过 overlay 窗口，但不会跳过 Electron 主窗口，于是 `<frontmost_app>` 变成 DeepSeek Harness。模型点到那扇窗，然后再把它切走。

[桌面划词工具条](../feature/2026-09-16-desktop-selection-toolbar.zh.md) 已经在工具条 IPC 之后的 2 秒内忽略 `activate`，模糊已聚焦的主窗口，并用 `activatePid` 回到划词所在进程。悬浮球按钮点击从不设置该标志。渲染进程 IPC 也来不及：`activate` 发生在点击的 mouse-down 里，早于渲染进程消息。无边框 `type: 'panel'` 在原生圆角不是直角时仍带隐藏标题栏（`NSWindowStyleMaskTitled`），点那一条会激活应用。

## 决策

当 `screen.getCursorScreenPoint()` 落在可见悬浮窗内时，`activate` 不调用 `focusPrimaryWindow()`。它调用 `noteOverlayOwnedActivation()`，使接下来 2 秒内的后续 `activate` 同样跳过。Dock 点击的光标在面板外，即使悬浮窗已经是 key window，仍然显示主窗口。悬浮窗右键菜单的打开主窗口仍直接调用 `focusPrimaryWindow()`。

当 `SelectionToolbarController.isSessionRunning()` 为真时，同一次 `activate` 在主窗口已聚焦时将其 `blur()`，并且除非悬浮窗报告文本框正聚焦，否则对监视器的 `lastFrontPid()` 调用 `activatePid`。进程内划词监视器从 `NSWorkspace.didActivateApplicationNotification` 记录该 pid，并跳过 Electron。`floating.js` 在 `focusin` / `focusout` 用 `setTextEditing` 报告文本框焦点；主按钮 `pointerup` 落在 `input`、`textarea` 和 `[contenteditable="true"]` 之外时调用 `restoreFrontApp`。`overlay-guard` 的 `input` begin 即使文本框正聚焦也会模糊已聚焦的主窗口并恢复 `lastFrontPid()`，因为 HID 会在下一次点击前模糊悬浮窗。

悬浮窗设置 `roundedCorners: false`。面板保持透明；CSS `border-radius` 仍绘制球和展开面板。直角原生边去掉隐藏标题栏。点击仍会激活应用时，`activate` 处理仍是兜底。

## 考虑过的替代方案

**用悬浮窗渲染进程 IPC 延长工具条的 2 秒标志。** 标志会在 `activate` 已经聚焦主窗口之后才设上。

**在整个 Computer Use 会话期间隐藏主窗口。** 主窗口可以留在另一块显示器上。只有一次会激活应用的悬浮窗点击才应把它送到后面并回到之前的应用。

**只设 `roundedCorners: false`，不做 `activate` 处理。** 内容区点击仍可能激活应用。阻止 `focusPrimaryWindow()` 的是该处理。

## 后果

运行中的 Computer Use 会话在悬浮窗点击之后保持之前的应用为前台，因此下一次 `<frontmost_app>` 不是 DeepSeek Harness。在 composer 或提问自定义文本框里打字不会恢复该应用，直到指针在字段外抬起，或直到 HID `input` begin。空闲时的悬浮窗点击不恢复其他应用；指针在面板上时也不拉起主窗口。[Computer Use 观察前台](../feature/2026-09-15-computer-use-observation-foreground.zh.md) 在主窗口确实是 z-order 中的下一扇窗时仍会报它。

## 测试

`apps/desktop/tests/main-startup.spec.ts` 钉住 `roundedCorners: false`、光标在悬浮窗内时不 `show` / `focus`、光标在窗外时仍打开主窗口、会话运行时模糊主窗口并对记住的 pid 调用 `activatePid`、文本框编辑期间跳过该 pid、编辑结束后 `floatingRestoreFront` 恢复它，以及即使正在编辑，`overlay-guard` `input` begin 也恢复它。`apps/desktop/tests/floating-renderer.spec.ts` 钉住运行中主按钮 `pointerup` 落在文本框外时调用 `restoreFrontApp`，以及 `#prompt` 的 `setTextEditing(true)` 且不恢复。`apps/desktop/tests/selection-toolbar-controller.spec.ts` 钉住 `restoreLastFrontApp` 对外部 pid 的恢复和对 Electron pid 的跳过。
