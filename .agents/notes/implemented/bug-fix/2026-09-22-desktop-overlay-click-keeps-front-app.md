# Agent Note: Desktop overlay click keeps the front app

Status: implemented

English | [中文](2026-09-22-desktop-overlay-click-keeps-front-app.zh.md)

## Problem

Clicking the macOS floating overlay (an ask-user option, Submit, or another panel button) activates DeepSeek Harness. `app` `activate` then calls `focusPrimaryWindow()`, which `show`s and `focus`es the main window. On macOS that orders the main window in front of the app Computer Use was driving. The next observation skips overlay windows but not the Electron main window, so `<frontmost_app>` becomes DeepSeek Harness. The model clicks that window and only then switches back.

[Desktop selection toolbar](../feature/2026-09-16-desktop-selection-toolbar.md) already ignores `activate` for 2s after toolbar IPC, blurs a focused main window, and `activatePid`s the selection's process. Overlay button clicks never set that flag. Renderer IPC cannot: `activate` runs inside the click's mouse-down, before the renderer message. A frameless `type: 'panel'` still has a hidden titlebar (`NSWindowStyleMaskTitled`) unless native corners are square, and that strip activates the app.

## Decision

`activate` does not call `focusPrimaryWindow()` when `screen.getCursorScreenPoint()` lies inside the visible floating window. It calls `noteOverlayOwnedActivation()` so a follow-up `activate` in that 2s window also skips. A Dock click, whose cursor is outside the panel, still shows the main window even if the overlay is already key. The overlay context menu's Open Main Window still calls `focusPrimaryWindow()` directly.

While `SelectionToolbarController.isSessionRunning()` is true, that same `activate` blurs the main window when it is focused and, unless the overlay reports a text field focused, `activatePid`s the monitor's `lastFrontPid()`. The in-process selection monitor records that pid from `NSWorkspace.didActivateApplicationNotification`, skipping Electron. `floating.js` reports text-field focus with `setTextEditing` on `focusin` / `focusout`, and a primary `pointerup` outside `input`, `textarea`, and `[contenteditable="true"]` calls `restoreFrontApp`. `overlay-guard` `input` begin blurs a focused main window and restores `lastFrontPid()` even when a text field is focused, because HID blurs the overlay before the next click.

The floating window sets `roundedCorners: false`. The panel stays transparent; CSS `border-radius` still draws the ball and the expanded panel. Square native corners drop the hidden titlebar. The `activate` handler remains the backstop when a click still activates the app.

## Alternatives considered

**Extend the toolbar's 2s flag from overlay renderer IPC.** The flag would be set after `activate` had already focused the main window.

**Hide the main window for the whole Computer Use session.** The main window can stay on another display. Only an activating overlay click should send it behind and return the previous app.

**`roundedCorners: false` without the `activate` handler.** A content click can still activate the app. The handler is what stops `focusPrimaryWindow()`.

## Consequences

A running Computer Use session keeps the previous app front after an overlay click, so the next `<frontmost_app>` is not DeepSeek Harness. Typing in the composer or the ask-user custom field does not restore that app until the pointer goes up outside the field, or until HID `input` begin. Idle overlay clicks do not restore another app and do not raise the main window when the pointer is over the panel. [Computer Use observation foreground](../feature/2026-09-15-computer-use-observation-foreground.md) still reports the main window when it really is the next window in z-order.

## Testing

`apps/desktop/tests/main-startup.spec.ts` pins `roundedCorners: false`, skips `show` / `focus` when the cursor is inside the overlay, still opens the main window for a cursor outside it, blurs and `activatePid`s the remembered pid while the session is running, skips that pid while a text field is editing, restores it from `floatingRestoreFront` after editing ends, and restores it on `overlay-guard` `input` begin even while editing. `apps/desktop/tests/floating-renderer.spec.ts` pins `restoreFrontApp` on a running primary `pointerup` outside a text field and `setTextEditing(true)` plus no restore for `#prompt`. `apps/desktop/tests/selection-toolbar-controller.spec.ts` pins `restoreLastFrontApp` for a foreign pid and a skip for the Electron pid.
