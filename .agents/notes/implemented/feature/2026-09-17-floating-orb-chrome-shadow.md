# Agent Note: Floating-orb CSS shadow and pin stroke

Status: implemented

English | [中文](2026-09-17-floating-orb-chrome-shadow.zh.md)

## Problem

The macOS overlay is a transparent `type: 'panel'` window with `hasShadow: false`. The expanded 320×420 white panel has no outer edge, so it disappears against other light windows. Pinning drew `box-shadow: inset 0 0 0 3px` on `#panel` and `#ball`; the grey input pill (`#panel::after`) covers the bottom of that inner ring, so only the transcript card looks outlined. The collapsed 72px ball also sits flush on the desktop with no depth.

[Desktop floating orb](2026-09-14-desktop-floating-orb.md) still owns overlay construction, expand geometry, and pin/collapse. This note owns how chrome separates from the desktop: CSS drop shadow, hairline, outer pin stroke, and the 12px window inset that lets those paints exist.

## Decision

Visual sizes stay 72px and 320×420. `FLOATING_CHROME_INSET` (12px, `--chrome` in `floating.css`) pads the overlay window on every side so CSS paints are not clipped. Window origin is the 72px ball origin minus that inset. Work-area clamp keeps the visual 72px ball inside the display; chrome may hang 12px past the work-area edge. Collapse/expand compares window size to `FLOATING_BALL_WINDOW_SIZE` (96px), not 72.

Collapsed `#ball` uses a circular drop shadow and no border. Expanded unpinned `#panel` uses a panel drop shadow plus a 1px `--border` hairline; `#ball` drops its shadow and takes the same 1px ring so the silhouette does not break at the avatar. Pinned `#panel` and `#ball` replace those shadows with `box-shadow: 0 0 0 3px var(--pin)` (outer, not inset) so the stroke follows the rounded panel, the input pill's bottom edge, and the avatar. `#ball` does not use `overflow: hidden`; the GIF still clips through `#ball-gif` `border-radius`. Stop stays 14px inside the 72px pill cap, so its inset is `calc(var(--chrome) + 14px)`.

The overlay still sets `hasShadow: false`. Native Electron shadow on a transparent window would frame the full rectangular window, including empty chrome.

## Alternatives considered

**Enable BrowserWindow `hasShadow`.** macOS would shadow the 96×96 or 344×444 rectangle, including transparent corners, instead of the round ball or rounded panel.

**Keep the inset pin ring and add only a drop shadow.** The input pill would still hide the bottom of the inner stroke.

**Pixel-accurate click-through on the 12px chrome.** `setIgnoreMouseEvents({ forward: true })` plus renderer hit-testing is a separate overlay-guard change. The 12px inset is the chosen leak of always-on-top hits.

**A 3px `border` on pin instead of outer `box-shadow`.** That would shrink the border-box by 2px relative to the unpinned 1px hairline.

## Consequences

A 12px transparent ring around the ball can eat clicks meant for apps behind the overlay. Drag IPC still sends the visual ball origin; Host maps that origin to window bounds. `--chrome` in CSS and `FLOATING_CHROME_INSET` must stay equal.

## Testing

`floating-window.spec.ts` pins expand/move/clamp window bounds around the ball origin minus inset. `main-startup.spec.ts` pins expanded panel-window size and collapsed move/clamp at origin minus inset. `floating-renderer.spec.ts` pins `--chrome: 12px`, expanded hairline and panel shadow, outer 3px pin on `#panel` and `#ball`, no inset pin ring, no `overflow: hidden` on `#ball`, no `body:not(.expanded) #ball`, and Stop at `calc(var(--chrome) + 14px)`.
