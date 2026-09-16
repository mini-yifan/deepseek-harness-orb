# Agent Note: Computer Use transient window observation

Status: implemented

English | [中文](2026-09-16-computer-use-transient-window-observation.zh.md)

## Problem

[Computer Use focused-window observation](2026-09-16-computer-use-focused-window-observation.md) captures one overlay-skipped layer-0 window. macOS menus, combo lists, and popovers are usually a second CGWindow: an NSPopUpButton menu on this host is layer 101, same PID as the owner, and often hangs below that window. `screencapture -l` and ScreenCaptureKit `desktopIndependentWindow` record only the owner's backing store, so the model sees the closed control, clicks it again, and never sees the list. System Settings' default-browser popup is this class; Excel filters, browser suggestions, and context menus are the same.

## Decision

Observation still starts at the overlay-skipped layer-0 owner. [Focused-window observation](2026-09-16-computer-use-focused-window-observation.md) still owns that pick, `list_apps` / `open_app`, and window-id capture when no popup is open. This note owns folding open menus into the same screenshot and mapping 0–1000 through the union.

`inspectForeground` keeps the first remaining layer-0 window with both edges at least 64pt. Matching rules for which popup windows join that owner are owned by [Computer Use context-menu observation](../bug-fix/2026-09-16-computer-use-context-menu-observation.md): same-app windows (same PID or Helper-named) at any non-chrome layer, including 0 and 25, that intersect the owner expanded by 48pt, plus unrelated PIDs only at layer 101 with that pad. Dock and menu-bar layers 20 and 24 stay chrome. Transients on a different `NSScreen` are skipped. `ScreenInfo.bounds` becomes the union; `transientWindowIds` lists those popup ids. Existing `mapNormalizedToGlobal` maps through `bounds`, so a menu below the owner stays clickable.

When `transientWindowIds` is empty, capture stays `screencapture -l -o` or the helper `--window=` / `desktopIndependentWindow`. When it is nonempty, capture is the union rectangle: a full `screencapture` plus `sips --cropOffset` crop with no overlay ids (`screencapture -R` returns "could not create image from rect" on this OS), or helper `--region=` with `SCContentFilter(display:excludingWindows:)` plus `sourceRect`. There is no `screencapture -R` fallback while overlay ids are set. The helper still starts `NSApplication` on the main actor with `.prohibited` before ScreenCaptureKit.

POLICY states that the attached image includes open menus and popovers of that window and still omits the Dock, menu bar, other applications, and other displays.

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

Package tests pin inspect JSON `transients` onto `ScreenInfo.transientWindowIds` and union `bounds`, `screencapture -l` when that list is empty, full `screencapture` plus `sips` crop when it is not, helper `--window=` vs `--region=` with overlay ids and no `screencapture` fallback, AppKit main-actor init, helper `--region=` / `excludingWindows` / `sourceRect` source pins, layer 101 in the inspect script, and POLICY's menus sentence. [Context-menu observation](../bug-fix/2026-09-16-computer-use-context-menu-observation.md) pins same-app layer 0 / Helper matching. The authored [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) system prompt pins that POLICY line.
