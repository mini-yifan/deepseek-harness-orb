# Agent Note: Windows floating orb

Status: implemented

English | [中文](2026-09-22-windows-floating-orb.zh.md)

## Problem

The floating ball, selection toolbar, and Computer Use desktop backend were created only on macOS. Windows Desktop kept a single main window, and Computer Use threw at execute. The ball page, `dsh_orb` session, and tool protocol were already shared.

## Decision

Windows creates the same overlay after Host ready. The window is a borderless transparent always-on-top window at the screen-saver level. It does not use `type: 'panel'` or `setVisibleOnAllWorkspaces`, which are Darwin-only. `app.setActivationPolicy` and `app.dock.show()` stay on macOS. Linux still does not create the ball. Settings writes are allowed on macOS and Windows.

While a Computer Use capture interval is open, Windows sets `contentProtection` on the ball and the selection toolbar so capture APIs that honor `WDA_EXCLUDEFROMCAPTURE` omit them. macOS still excludes those windows by ScreenCaptureKit id. Click-through during HID is unchanged.

`createPlatformBackend('win32')` returns a Windows backend. It captures the foreground window with GDI into PNG and posts click, scroll, hotkey, long-press, and drag with `SendInput`. `input_text` pastes with Ctrl+V and restores the previous string clipboard. `open_in_finder` opens Explorer. When the foreground process integrity is higher than this process, input throws instead of being dropped silently. Tests inject `WindowsDesktopOps` and do not post real input.

The selection toolbar keeps its controller and page. Windows installs `WH_MOUSE_LL` and `WH_KEYBOARD_LL` in the Electron main process and reads the focused selection with UI Automation. The events match the Darwin helper. A failed hook install logs and still emits `ready`, so the ball remains usable.

## Alternatives considered

**Reuse `type: 'panel'` on Windows.** Electron does not provide that window type or Space visibility there. A screen-saver always-on-top window is the available equivalent.

**Split Computer Use into a Service Definition and a Windows provider package.** The package is still one experimental plugin. A second backend file does not by itself need a new package.

**Hide the ball during capture instead of display affinity.** Hiding flashes the overlay. Display affinity leaves it visible to the user.

## Consequences

Closing the main window leaves the ball running until Quit, on Windows as on macOS, because `window-all-closed` fires only after every window closes. Virtual-desktop visibility follows Windows always-on-top behavior and is not macOS Space behavior. A non-elevated process cannot click or type into an elevated window. Linux Computer Use still throws `computer-use: desktop control is implemented only on macOS and Windows`.

## Testing

`apps/desktop/tests/main-startup.spec.ts` creates the Win32 overlay and toolbar, checks screen-saver always-on-top, and checks content protection only during capture. Linux still creates neither. `windows.spec.ts` drives the backend through injected operations. `windows-selection.spec.ts` checks selection events without installing a hook.
