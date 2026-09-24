# Agent Note: Computer Use transient window observation

Status: implemented

English | [中文](2026-09-16-computer-use-transient-window-observation.zh.md)

## Problem

[Computer Use focused-window observation](2026-09-16-computer-use-focused-window-observation.md) captures one overlay-skipped layer-0 window. macOS menus, combo lists, and popovers are usually a second CGWindow: an NSPopUpButton menu on this host is layer 101, same PID as the owner, and often hangs below that window. `screencapture -l` and ScreenCaptureKit `desktopIndependentWindow` record only the owner's backing store, so the model sees the closed control, clicks it again, and never sees the list. System Settings' default-browser popup is this class; Excel filters, browser suggestions, and context menus are the same.

## Decision

Observation still starts at the overlay-skipped layer-0 owner. [Focused-window observation](2026-09-16-computer-use-focused-window-observation.md) still owns that pick and `list_apps` / `open_app`. [Computer Use app-window observation](2026-09-16-computer-use-app-window-observation.md) owns which family windows join the union and that capture is always a display crop. This note owns the region helper: a full `screencapture` plus `sips --cropOffset` crop with no overlay ids (`screencapture -R` returns "could not create image from rect" on this OS), or helper `--region=` with `SCContentFilter(display:excludingWindows:)` plus `sourceRect`. There is no `screencapture -R` fallback while overlay ids are set. The helper still starts `NSApplication` on the main actor with `.prohibited` before ScreenCaptureKit. The helper still implements `--window=` / `desktopIndependentWindow`; observation does not call it.

`inspectForeground` keeps the first remaining layer-0 window with both edges at least 64pt. Matching rules for which windows join that owner are owned by [Computer Use app-window observation](2026-09-16-computer-use-app-window-observation.md). `ScreenInfo.bounds` is the union; `transientWindowIds` lists extra ids. Existing `mapNormalizedToGlobal` maps through `bounds`, so a menu below the owner stays clickable.

POLICY for the attached application image is owned by [Computer Use app-window observation](2026-09-16-computer-use-app-window-observation.md).

This cut does not add Accessibility `click_element`, a menu-only observation, per-window compositing, or a full-desktop fallback.

## Alternatives considered

**Make the popup the only observation.** The next screenshot would be a tiny menu with no parent controls. Clicks outside the list have no coordinates in that image.

**Composite each popup with `desktopIndependentWindow`.** Z-order, shadows, and the cursor then have to be rebuilt. A display-region shot already shows the pixels the user sees.

**Always crop the owner window's display rectangle.** Menus inside that rect would appear, but a list that hangs below the window would still be clipped, and overlapping apps would enter every shot.

**`screencapture -R` for CLI unions.** On this OS it returns `could not create image from rect`. CLI unions crop a full `screencapture` with `sips` instead.

**AX `click_element` for menu items.** Paint, canvas tools, and games still need screenshots. This cut keeps vision and only widens the raster.

## Consequences

A region shot can include another app that overlaps the union. Overlay ids still omit the floating ball. A menu that never appears in `CGWindowList` and extends outside the owner is still missed. Same-app overlapping palettes enlarge the shot.

## Testing

Package tests pin inspect JSON `transients` onto `ScreenInfo.transientWindowIds` and union `bounds`, full `screencapture` plus `sips` crop, helper `--region=` with overlay ids and no `screencapture` fallback, AppKit main-actor init, and helper `--region=` / `excludingWindows` / `sourceRect` source pins. [App-window observation](2026-09-16-computer-use-app-window-observation.md) pins family join, always-region observation argv, and POLICY's application sentence. [Context-menu observation](../bug-fix/2026-09-16-computer-use-context-menu-observation.md) pins settle-before-inspect and `withGuiTurn`. The authored [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) system prompt pins that POLICY line.
