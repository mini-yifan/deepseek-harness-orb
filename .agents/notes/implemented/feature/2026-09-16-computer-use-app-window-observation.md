# Agent Note: Computer Use app-window observation

Status: implemented

English | [中文](2026-09-16-computer-use-app-window-observation.zh.md)

## Problem

[Computer Use focused-window observation](2026-09-16-computer-use-focused-window-observation.md) picks one overlay-skipped layer-0 window. Extra CGWindows then join only through overlap, a Helper name prefix, or layer 101. WeChat menus match. WPS「新建」and other same-app panels often do not: they can use a different PID or name and sit beside the owner. Window-id capture (`screencapture -l` / ScreenCaptureKit `desktopIndependentWindow`) records only that owner's backing store, so those panels never appear.

## Decision

[Focused-window observation](2026-09-16-computer-use-focused-window-observation.md) still owns which app: first remaining layer-0 window with both edges at least 64pt after overlay skip. This note owns what is in the shot.

From the owner PID, `inspectForeground` builds an app family in JXA via `NSWorkspace.runningApplications`: same PID; `localizedName` equal or `A` / `A …`; `bundleIdentifier` equal or one is the other plus `.` (`com.kingsoft.wpsoffice.mac` / `com.kingsoft.wpsoffice.mac.promecefpluginhost`). It unions every same-`NSScreen`, alpha > 0, non-chrome window of that family. Chrome stays Dock and menu-bar layers 20/24 and `CHROME_WINDOW_OWNERS`. Family windows join with no 48pt overlap test. Unrelated-PID layer 101 plus 48pt pad remains only as WindowServer-menu fallback. `transientWindowIds` lists extra window ids and may be empty; `x`/`y`/`width`/`height` are always the union.

Capture is always that union rectangle: CLI full `screencapture` plus `sips` crop; Desktop helper `--region=` plus `excludingWindows`. Observation does not use window-id capture. Overlay ids still omit the ball. Other apps that overlap the union can appear; that is accepted.

Settle-before-inspect and `withGuiTurn` stay with [Computer Use context-menu observation](../bug-fix/2026-09-16-computer-use-context-menu-observation.md). Region helper mechanics stay with [Computer Use transient window observation](2026-09-16-computer-use-transient-window-observation.md).

POLICY states that the attached image is the frontmost application on this display, including that app's open menus, popovers, and panels, and still omits the Dock, menu bar, other applications except overlap in the union, and other displays.

This cut does not add Accessibility `click_element`, a full-desktop fallback, or per-window compositing.

## Alternatives considered

**Keep guessing transients with overlap and a Helper name prefix.** Same-app panels beside the owner stay out of the shot.

**Window-id capture when the family is one window.** The owner's backing store still omits a sibling that is on screen, and the two capture paths disagree about on-screen pixels.

**Full-desktop screenshot.** Dock, other apps, and other displays return to the image.

**Treat every on-screen layer-0 window as family.** Unrelated overlapping apps would join every screenshot.

## Consequences

A region shot includes any other app that overlaps the union rectangle. A sibling on another `NSScreen` is omitted. A window that never appears in `CGWindowList` is still missed. A large same-bundle palette enlarges the shot.

## Testing

Package tests pin inspect JXA family pid / bundle-prefix join, no pad on family windows, pad still on unrelated layer 101, one-window capture as `screencapture` plus `sips` or helper `--region=` (not `-l` / `--window=`), overlay-id `--region=` with exclude, and POLICY's application sentence. [Transient window observation](2026-09-16-computer-use-transient-window-observation.md) pins helper `--region=` / `excludingWindows` / `sourceRect`. [Context-menu observation](../bug-fix/2026-09-16-computer-use-context-menu-observation.md) pins settle-before-inspect and `withGuiTurn`. The authored [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) system prompt pins that POLICY line.
