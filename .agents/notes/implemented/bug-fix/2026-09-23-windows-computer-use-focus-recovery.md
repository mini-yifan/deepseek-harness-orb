# Agent Note: Windows Computer Use focus recovery

Status: implemented

English | [中文](2026-09-23-windows-computer-use-focus-recovery.zh.md)

## Problem

Typing into the Windows floating ball makes that `BrowserWindow` the foreground window. [Windows floating orb](../feature/2026-09-22-windows-floating-orb.md) skips the ball's HWND when choosing the observation, then reports the next operable window as `<frontmost_app>` with no `<focus_note>`. `hotkey` posts `SendInput` to whichever window is foreground. At HID begin the overlay calls `BrowserWindow.blur()`. On Windows, deactivating the foreground window lets the system activate the next visible top-level window in z-order, often another always-on-top overlay rather than the app in the screenshot. The chord does nothing, and the next screenshot still shows the same app, so the model retries keys until something clicks that app.

## Decision

`selectWindowsObservation` sets `focused` true only when `foregroundHwnd` is the owner or one of that owner's transients (an owned window, an intersecting same-process popup, or an intersecting system menu or combo dropdown). Otherwise `inspectForeground` adds `<focus_note>` with `UNFOCUSED_WINDOW_NOTE`: `Keyboard focus is on another window. hotkey brings this window forward first; click inside it if focus must land on a specific control.` [Computer Use observation foreground](../feature/2026-09-15-computer-use-observation-foreground.md) owns the tag; this note owns the Windows case.

`createWindowsDesktopBackend` remembers the last `listScreens` selection, including a later empty listing, which clears it. `hotkey` calls `focusWindow` on that owner before the elevated-window check and the chord when the current foreground hwnd is neither the owner nor a transient. `focusWindow` and `activateApp` share one helper: restore an iconic window, post Alt down, call `SetForegroundWindow`, retry once, then release Alt. [Foreground activation for the Win32 picker via a synthesized Alt press](2026-09-07-win32-picker-foreground-alt-key.md) owns why the Alt transition is required. Failure throws `computer-use: keyboard focus could not be moved to <app>; click inside the window, then retry hotkey` and posts no keys. `input_text` focuses by clicking and does not call `focusWindow`.

## Alternatives considered

**Report `<focus_note>` and leave `hotkey` unchanged.** The model can click a blank area of the window to move focus onto that app, but a chord posted before that click still hits the wrong window. That extra click is the trial-and-error the `hotkey` restore removes.

**Remember the previous foreground in the floating ball and restore it instead of `blur()`.** The composer has to accept keyboard focus, so the ball cannot be `focusable: false`. Restoring the hwnd from before the ball was focused does not cover a `hotkey` after focus has moved to some other skipped window. That Desktop Host change is separate from making `hotkey` target the observed hwnd.

**Change POLICY so `<focus_note>` no longer says to call `open_app`.** The no-window note and this Windows note share `<focus_note>`. The no-window case has no hwnd for `hotkey` to restore. The Windows sentence in the observation names `hotkey` as the bring-forward for the reported window. POLICY stays the text the computer-use snapshot pins.

## Consequences

A `hotkey` whose target is already foreground, or whose foreground hwnd is a transient of that window, posts keys with no `SetForegroundWindow`. A `hotkey` against an unfocused observation pays that call first. The extra `<focus_note>` is model-visible on Windows only. When `<focus_note>` is present, the foreground envelope omits `<frontmost_folder>`. macOS inspect is unchanged. The ball stays focusable; this note does not restore the previous foreground from overlay `blur()`.

## Testing

`windows-foreground.spec.ts` pins `focused` true for an owner and for a foreground menu of that owner, and false when the foreground hwnd is ineligible or an excluded overlay. `windows.spec.ts` pins the exact note text, no `focusWindow` when the foreground hwnd is the owner or its menu, `focusWindow` before the chord, the throw with no keys, and no restore after a later empty listing.
