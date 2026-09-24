# Agent Note: Computer Use context-menu observation

Status: implemented

English | [中文](2026-09-16-computer-use-context-menu-observation.zh.md)

## Problem

[Computer Use transient window observation](../feature/2026-09-16-computer-use-transient-window-observation.md) folds NSPopUpButton menus at layer 101 into the frontmost-window screenshot. WeChat, Electron, Chromium, and Qt context menus are usually a second CGWindow at layer 0 or 25, often owned by a Helper process. `inspectForeground` dropped those windows, so capture stayed on the owner's backing store and the model never saw the open menu.

`observeDesktop` listed windows before `postActionWaitMs`, then captured from that stale `ScreenInfo`. Overlay-guard restored the always-on-top ball between HID `withInput` and recapture `withCapture`, which dismisses custom menus.

## Decision

[Transient window observation](../feature/2026-09-16-computer-use-transient-window-observation.md) still owns the region helper. [Computer Use app-window observation](../feature/2026-09-16-computer-use-app-window-observation.md) owns which windows join that union. This note owns when inspect runs, and overlay click-through across HID plus recapture.

Matching still starts at the overlay-skipped layer-0 owner. Family join and the unrelated layer-101 pad are owned by [Computer Use app-window observation](../feature/2026-09-16-computer-use-app-window-observation.md).

`observeDesktop` waits `postActionWaitMs` first, then `listScreens` / inspect / capture.

HID tools and `open_app` call `DesktopBackend.withGuiTurn` around the action and recapture. `wrapDesktopBackend` maps that to overlay-guard `withInput` so nested HID `withInput` does not restore the ball until the screenshot returns. Desktop Host refcounts nested `withInput` / `withCapture` so one turn sends one input begin/end; capture inside that turn reuses the input-begin `excludeWindowIds` and does not toggle overlay click-through. `wait`, `long_wait`, `screenshot`, and `list_apps` omit `withGuiTurn`. Observation stays the frontmost-app window union; there is no full-desktop fallback.

## Alternatives considered

**Always crop the display rectangle of the owner.** Menus that hang outside that rect stay clipped, and overlapping apps enter every shot.

**Treat every on-screen layer-0 window as a transient.** Unrelated overlapping apps would join every screenshot.

**Standing overlay click-through for the whole Computer Use session.** That would block the Stop control on the ball.

**Wrap every `plugin.ts` execute, including first-frame `agent/pre-step`.** First-frame attach is not HID; holding input cloak there is unnecessary.

## Consequences

A same-app palette that overlaps the owner enlarges the shot. A menu that never appears in `CGWindowList` is still missed. Overlay Stop is unhittable for the duration of one HID tool plus settle and capture.

## Testing

Package tests pin `observeDesktop` delay before `listScreens`, `withGuiTurn` via `withInput` with nested HID plus capture, HID tools calling `withGuiTurn`, and `wait` / `long_wait` / `screenshot` / `list_apps` skipping it. Family join pins live on [app-window observation](../feature/2026-09-16-computer-use-app-window-observation.md). Desktop Host tests pin nested `withInput` plus `withCapture` as one input begin/end. Electron tests pin no extra overlay blur while input stays held.
