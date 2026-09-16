# Agent Note: Computer Use context-menu observation

Status: implemented

English | [中文](2026-09-16-computer-use-context-menu-observation.zh.md)

## Problem

[Computer Use transient window observation](../feature/2026-09-16-computer-use-transient-window-observation.md) folds NSPopUpButton menus at layer 101 into the frontmost-window screenshot. WeChat, Electron, Chromium, and Qt context menus are usually a second CGWindow at layer 0 or 25, often owned by a Helper process. `inspectForeground` dropped those windows, so capture stayed on the owner's backing store and the model never saw the open menu.

`observeDesktop` listed windows before `postActionWaitMs`, then captured from that stale `ScreenInfo`. Overlay-guard restored the always-on-top ball between HID `withInput` and recapture `withCapture`, which dismisses custom menus.

## Decision

[Transient window observation](../feature/2026-09-16-computer-use-transient-window-observation.md) still owns region capture when `transientWindowIds` is nonempty. This note owns which windows join that union, when inspect runs, and overlay click-through across HID plus recapture.

Matching still starts at the overlay-skipped layer-0 owner. Same-PID windows at any non-chrome layer, including 0 and 25, join when they intersect the owner expanded by 48pt. Another PID joins when `kCGWindowOwnerName` is equal or one name is the other plus a space (`WeChat` / `WeChat Helper (Renderer)`), with the same intersection. Unrelated PIDs still join only at layer 101 with that pad. Dock and menu-bar layers 20 and 24 stay chrome; layer 25 does not.

`observeDesktop` waits `postActionWaitMs` first, then `listScreens` / inspect / capture.

HID tools and `open_app` call `DesktopBackend.withGuiTurn` around the action and recapture. `wrapDesktopBackend` maps that to overlay-guard `withInput` so nested HID `withInput` does not restore the ball until the screenshot returns. Desktop Host refcounts nested `withInput` / `withCapture` so one turn sends one input begin/end; capture inside that turn reuses the input-begin `excludeWindowIds` and does not toggle overlay click-through. `wait`, `long_wait`, `screenshot`, and `list_apps` omit `withGuiTurn`. Observation stays one window union its menus; there is no full-desktop fallback.

## Alternatives considered

**Always crop the display rectangle of the owner.** Menus that hang outside that rect stay clipped, and overlapping apps enter every shot.

**Treat every on-screen layer-0 window as a transient.** Unrelated overlapping apps would join every screenshot.

**Standing overlay click-through for the whole Computer Use session.** That would block the Stop control on the ball.

**Wrap every `plugin.ts` execute, including first-frame `agent/pre-step`.** First-frame attach is not HID; holding input cloak there is unnecessary.

## Consequences

A same-app palette that overlaps the owner enlarges the shot. A menu that never appears in `CGWindowList` is still missed. Overlay Stop is unhittable for the duration of one HID tool plus settle and capture.

## Testing

Package tests pin inspect JXA `relatedOwner`, layer 0 / Helper name matching, chrome layers 20/24 without 25, `observeDesktop` delay before `listScreens`, `withGuiTurn` via `withInput` with nested HID plus capture, HID tools calling `withGuiTurn`, and `wait` / `long_wait` / `screenshot` / `list_apps` skipping it. Desktop Host tests pin nested `withInput` plus `withCapture` as one input begin/end. Electron tests pin no extra overlay blur while input stays held.
