# Agent Note: Floating-orb primary pointer drag

Status: implemented

English | [中文](2026-09-17-floating-orb-primary-pointer-drag.zh.md)

## Problem

The macOS overlay treats every `pointerdown` on the ball as the start of a window grab. A right-click therefore records a grab offset and captures the pointer. Electron then shows the native overlay menu, which often swallows that gesture's `pointerup`. The renderer keeps the grab. Later `pointermove` events on the ball, including hover with no button down, call `floating.move`, so the window follows the cursor until the pointer leaves the overlay. Overlay chrome also has no `user-select: none`, so the same right-click selects the composer placeholder; clicking the ball (a button) does not collapse that selection.

[Desktop floating orb](../feature/2026-09-14-desktop-floating-orb.md) still owns overlay construction, expand geometry, and grab-offset movement. This note owns which pointer buttons start that grab and that chrome is not text-selectable.

## Decision

`floating.js` starts a grab only when `pointerdown.button` is `0`, and it moves the window only while `pointermove.buttons` includes the primary bit. `lostpointercapture` and `pointercancel` run the same finish path as `pointerup`, and a finished drag suppresses the following pin-toggle so a stolen capture cannot pin on the later `pointerup`. Secondary `pointerup` does not pin.

Overlay `html`/`body` set `user-select: none`. `#prompt` and `#question-custom` keep `user-select: text` so typed composer and ask-user drafts remain selectable for the overlay cut/copy/paste menu.

## Alternatives considered

**Cancel the grab only from `webContents` `context-menu` via IPC.** That would still leave hover-follow if any other path swallowed `pointerup`, and it would not stop a right-click from selecting chrome.

**`-webkit-app-region: drag` on the ball.** Native window drag would race the pin click, Stop, and expand geometry that keep the ball origin fixed.

**`user-select: none` without filtering pointer buttons.** The blue selection would go away; hover would still move the window after a swallowed right-click `pointerup`.

## Consequences

Middle-click does not pin or drag. A right-click on the ball no longer selects the placeholder; focusing the composer still allows selecting typed text.

## Testing

`apps/desktop/tests/floating-renderer.spec.ts` pins primary-button grab-offset movement, ignores secondary `pointerdown` plus hover `pointermove`, ends a primary grab on `buttons === 0` and on `lostpointercapture`, and requires `user-select: none` on overlay chrome with text selection on `#prompt` and `#question-custom`.
