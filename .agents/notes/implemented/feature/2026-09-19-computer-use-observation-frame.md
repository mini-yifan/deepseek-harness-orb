# Agent Note: Computer Use observation-frame ribbon

Status: implemented

English | [中文](2026-09-19-computer-use-observation-frame.zh.md)

## Problem

Computer Use drives the real pointer on the overlay-skipped frontmost app's on-screen window union. The human watching that Mac has no chrome that marks which rectangle the agent can see and click. A screenshot overlay would enter the model's image and shift aiming. Hiding Desktop chrome during capture already flashes the floating ball.

## Decision

Desktop paints a static, click-through hollow ribbon around the current `ScreenInfo.bounds` (the same union rectangle capture crops and 0–1000 clicks map through). The ribbon is human-only: ScreenCaptureKit omit lists include its CGWindowID whenever it is visible, matching the floating ball. It never appears in model-facing images. CLI and Web compositions have no Electron overlay and do not show it.

`wrapDesktopBackend` waits for `ComputerUseOverlayGuard.setObservationFrame` after each `listScreens` (first screen bounds, or `null` when the list is empty). Desktop Host protocol 7 adds ack'd `observation-frame` / `observation-frame-ack` on the overlay-guard transport. Electron reuses one `BrowserWindow` (`dsh-app://shell/observation-frame.html`), inflates bounds by 16pt so a 4px static teal-to-violet stroke and drop-shadow glow sit just outside the region, intersects the work area without translating the overlay, and sets per-edge CSS padding from leftover outset so the inner hole stays on the observation rectangle. A work-area-flush edge paints the 4px stroke just inside. The window always `setIgnoreMouseEvents(true, { forward: true })`, `setContentBounds`, and `showInactive`. The ribbon uses `setAlwaysOnTop(true, 'floating', 0)`; the floating overlay and selection toolbar use relative level `1`, and each ribbon show calls `moveTop` on the overlay so the ball stays above the ribbon. `applyComputerUse` hides on `session/event` `turn/end`. Host stop also hides. Nested `withCapture` inside `withInput` still sends capture begin/end so a newly shown frame id reaches the next exclude list without toggling HID click-through; [Desktop overlay-guard IPC](../architecture/2026-09-14-desktop-overlay-guard.md) owns that cloak.

## Alternatives considered

**Draw the ribbon into the screenshot.** The model would see chrome that is not a clickable control, and coordinates assume the observation union owns every pixel.

**Fire-and-forget Host → Electron bounds.** The next overlay-guard begin can race the window show and photograph the ribbon.

**Hide the ribbon during capture.** The user would see it flash off, the same failure as hiding the floating ball.

**Accessibility overlay or drawing into the target app.** That needs extra TCC, cannot exclude from ScreenCaptureKit by a Desktop window id, and paints into apps Computer Use does not own.

**Follow only the owner window, not the family union.** The agent can click anywhere in the union, including same-app panels, so the ribbon would mark a smaller region than the click space.

## Consequences

A work-area-flush observation edge paints the 4px stroke just inside that edge so the inner hole stays on the observation rectangle; glow that would leave the work area is clipped. Other apps that overlap the union sit inside the ribbon; that matches the shot. Concurrent Computer Use sessions share one frame window (last bounds win). Empty first frames leave the ribbon hidden until `listScreens` returns a rectangle.

## Testing

Plugin tests pin `wrapDesktopBackend` `setObservationFrame` with bounds and `null`, pass-through without a sender, and `turn/end` clear. Host tests pin observation-frame send/ack/timeout/abort, pass-through without a sender, and nested `withCapture` inside `withInput` refreshing exclude ids. Electron tests pin inflate plus work-area intersection, per-edge glow/stroke so the inner hole stays on the observation rectangle (4px inside on a flush edge), CSS variables from `showObservationFrame`, always click-through, visible frame id in `overlayWindowExcludeIds`, hidden omitted, CSS without `animation`, 4px stroke plus drop-shadow, floating overlay above the ribbon, protocol 7 mismatch, and Host-stop hide.
