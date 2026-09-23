# Agent Note: Windows Computer Use 焦点恢复

Status: implemented

[English](2026-09-23-windows-computer-use-focus-recovery.md) | 中文

## 问题

在 Windows 悬浮球里输入会使该 `BrowserWindow` 成为前台窗口。[Windows 悬浮球](../feature/2026-09-22-windows-floating-orb.zh.md) 在选择观察窗口时跳过球的 HWND，然后把下一个可操作窗口报成 `<frontmost_app>`，且没有 `<focus_note>`。`hotkey` 用 `SendInput` 把按键送到当前前台窗口。HID 开始时 overlay 调用 `BrowserWindow.blur()`。在 Windows 上，取消前台窗口的激活后，系统会激活 z-order 中下一个可见顶层窗口，那常常是另一个置顶 overlay，而不是截图里的应用。快捷键没有效果，下一张截图仍是同一个应用，于是模型反复重试，直到有一次点击落在该应用上。

## 决策

`selectWindowsObservation` 仅当 `foregroundHwnd` 是 owner，或是该 owner 的瞬时窗口（owned 窗口、相交的同进程 popup，或相交的系统菜单 / 组合框下拉）时，把 `focused` 设为 true。否则 `inspectForeground` 加上 `<focus_note>`，文本是 `UNFOCUSED_WINDOW_NOTE`：`Keyboard focus is on another window. hotkey brings this window forward first; click inside it if focus must land on a specific control.`。[Computer Use 观察前台元数据](../feature/2026-09-15-computer-use-observation-foreground.zh.md) 拥有该标签；本笔记拥有 Windows 这一情况。

`createWindowsDesktopBackend` 记住最近一次 `listScreens` 的选择；之后一次空的列举会清掉它。当前前台 hwnd 既不是该 owner 也不在其瞬时窗口里时，`hotkey` 在提权检查和组合键之前对那个 owner 调用 `focusWindow`。`focusWindow` 与 `activateApp` 共用一个 helper：若窗口最小化则先恢复，按下 Alt，调用 `SetForegroundWindow`，重试一次，然后松开 Alt。[通过合成的 Alt 按键让 Win32 选择器获得前台激活](2026-09-07-win32-picker-foreground-alt-key.zh.md) 拥有为何需要这次 Alt 过渡。失败时抛出 `computer-use: keyboard focus could not be moved to <app>; click inside the window, then retry hotkey`，并且不发送按键。`input_text` 靠点击聚焦，不调用 `focusWindow`。

## 考虑过的替代方案

**只报告 `<focus_note>`，不改 `hotkey`。** 模型可以点击窗口里的空白处，把焦点移到该应用，但那次点击之前发出的组合键仍会打到错误的窗口。多出来的点击就是 `hotkey` 恢复所要去掉的试错。

**在悬浮球里记住原先的前台窗口，用它替换 `blur()`。** 输入框必须能获得键盘焦点，因此球不能设成 `focusable: false`。恢复球获焦之前的那个 hwnd，覆盖不了焦点已经移到另一个被跳过的窗口之后的 `hotkey`。那是 Desktop Host 的另一项改动，不能代替让 `hotkey` 对准观察到的 hwnd。

**改 POLICY，让 `<focus_note>` 不再要求调用 `open_app`。** 没有窗口时的提示和这条 Windows 提示共用 `<focus_note>`。没有窗口时，`hotkey` 没有 hwnd 可以恢复。观察里的 Windows 句子已经说明 `hotkey` 会把报告的窗口带到前台。POLICY 保持 computer-use snapshot 钉住的那段文本。

## 后果

目标窗口已经是前台，或前台 hwnd 是该窗口的瞬时窗口时，`hotkey` 直接发送按键，不调用 `SetForegroundWindow`。观察窗口没有焦点时，`hotkey` 先付这一次调用。多出来的 `<focus_note>` 只在 Windows 上对模型可见。`<focus_note>` 存在时，前台信封省略 `<frontmost_folder>`。macOS 的 inspect 不变。球仍然可以获得焦点；本笔记不从 overlay 的 `blur()` 恢复原先的前台窗口。

## 测试

`windows-foreground.spec.ts` 钉住：owner 为前台、以及该 owner 的菜单为前台时 `focused` 为 true；前台 hwnd 不合格或是被排除的 overlay 时为 false。`windows.spec.ts` 钉住提示原文、前台 hwnd 是 owner 或其菜单时不调用 `focusWindow`、`focusWindow` 发生在组合键之前、失败时抛错且没有按键，以及之后一次空列举不再恢复。
