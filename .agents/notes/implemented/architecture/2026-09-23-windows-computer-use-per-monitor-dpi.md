# Agent Note: Windows Computer Use per-monitor coordinates

Status: implemented

English | [中文](2026-09-23-windows-computer-use-per-monitor-dpi.zh.md)

## Problem

Computer Use on Windows screenshots a rectangle and turns a later 0–1000 or pixel position into a `SendInput` point in that same rectangle. The Desktop Host is a DPI-unaware `node.exe`. In that awareness, `GetWindowRect` and `SendInput` use virtualized logical pixels, while `BitBlt` addresses physical pixels. On a 200% display those spaces disagree, so a point taken from the screenshot misses the control. `GetWindowRect` also includes the invisible resize border. The Windows walk took `GetForegroundWindow` alone, so it did not skip the floating ball or union an open menu the way the macOS walk does. A mixed-DPI layout is not one scale factor: a 100% display stays 1:1 while a 200% display is doubled.

## Decision

Every Win32 call that reads a rectangle or posts pointer input sets the calling thread to per-monitor v2, or to per-monitor when v2 is refused, and restores the previous thread awareness before returning. `createProductionWindowsOps` does not change the process awareness. Window bounds are `DWMWA_EXTENDED_FRAME_BOUNDS`, with `GetWindowRect` only when that attribute fails. `scale` is the monitor's effective DPI divided by 96. `movePointer` posts an absolute `SendInput` in that physical virtual screen and, when `GetCursorPos` disagrees, corrects with `SetCursorPos`.

`listScreens` and `inspectForeground` both call `selectWindowsObservation` with `activeCaptureExcludeWindowIds()`. The owner is the foreground window when it is eligible, otherwise the first eligible top-level window in z-order. Eligible means visible, not minimized, not cloaked, not an overlay hwnd, not `WS_EX_TOOLWINDOW`, not a shell class (`Shell_TrayWnd`, `Shell_SecondaryTrayWnd`, `Progman`, `WorkerW`), not a system menu or combo dropdown, and at least `MIN_LAYER0_WINDOW_EDGE` physical pixels on each edge. Same-process windows join when their owner chain reaches that window, or when they are an intersecting `WS_POPUP`. Another process joins only for an intersecting `#32768` menu or `ComboLBox`. Joined windows must sit on the owner's monitor. The screenshot is a `BitBlt` of that union. For an `ApplicationFrameWindow`, the app name and process id used for the union come from the child `Windows.UI.Core.CoreWindow`.

Click, drag, scroll, and chord timing match the macOS HID script: 80 ms after the move, 50 ms between button down and up, 100 ms between clicks of a double-click, ten drag steps, and one wheel notch per `scroll_level`. Navigation keys use `KEYEVENTF_EXTENDEDKEY`. `input_text` waits 80 ms after Ctrl+V before restoring the string clipboard. `activateApp` restores a minimized window, posts Alt around `SetForegroundWindow`, and throws when that window does not become foreground.

On Windows, `getMediaSourceId()` is `window:<HWND>:0`. The same exclude list the macOS backend passes to ScreenCaptureKit is the HWND skip list. Display affinity stays on for the capture interval and for the HID interval, because the post-action screenshot runs inside `withInput` and does not send a second capture begin. [Desktop overlay-guard IPC](2026-09-14-desktop-overlay-guard.md) owns the cloak. [Windows floating orb](../feature/2026-09-22-windows-floating-orb.md) owns the ball window.

## Alternatives considered

**Set per-monitor awareness on the process.** The Host process also runs directory pickers and other Win32 calls on this thread. A process-wide change would alter those calls. The thread context is set for one computer-use call and then restored.

**Stay DPI-unaware and multiply `BitBlt` coordinates by a scale.** A mixed-DPI virtual screen has no single scale. The 100% display and the 200% display are virtualized differently, and the virtual origin is not a uniform multiply of the physical origin.

**Capture with `PrintWindow` or Windows Graphics Capture instead of a screen rectangle.** macOS observation is a screen rectangle of the window union, including pixels that overlap it. `PrintWindow` misses DWM-composed and GPU windows. `BitBlt` of the union matches that observation.

## Consequences

A 0–1000 position divides the screenshot the model sees. The same fraction maps to physical pixels on a 100% display and a 200% display, including windows whose origin is negative. The thread returns to the process DPI awareness after each call. The taskbar and the desktop are not observation owners. A menu on another monitor is not merged into the shot. A non-elevated process still cannot click an elevated window. `activateApp` fails visibly when Windows does not grant foreground, instead of reporting success.

## Testing

`windows-foreground.spec.ts` pins owner selection, overlay and shell skips, owner-chain and popup unions, cross-process menus, and three monitors at 100%, 200%, and 150% with negative origins. `windows.spec.ts` pins injected click, drag, scroll, extended-key, and clipboard order without posting input. On a machine whose `EnumDisplayMonitors` list was the 2560×1600 primary at 192 DPI and a 1920×1080 display at 96 DPI with origin `(0, -1080)`, pointer centers on both displays landed on the aimed pixel and thread awareness returned to unaware. A third display was not attached for that check.
