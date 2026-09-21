# Agent Note: Floating-orb left/right edge dock

Status: implemented

English | [中文](2026-09-20-floating-orb-edge-dock.zh.md)

## Problem

The macOS floating ball stays fully on screen. A user who parks it against the left or right edge still has a 72px disk covering the desktop, and the overlay already refuses to dock. There is no way to hide the ball into that edge while still marking where it went.

[Desktop floating orb](2026-09-14-desktop-floating-orb.md) still owns overlay construction, expand geometry, and pin/collapse. This note owns when a drag docks to a tab, how the tab restores the ball, and which live overlay states refuse dock.

## Decision

Cold start remains a full 72px ball on the primary work-area right edge. Dock is in-memory only (`WeakMap` on the overlay `BrowserWindow`); restart does not restore a tab.

A primary-button drag on the collapsed ball may hang past a display edge; dock is committed on **pointer-up clamp**, not during move. Once one-fifth of the 72px disk (`FLOATING_DOCK_OVERLAP`) sits past the current display's left or right **`bounds`** (screen edge, not work area), the overlay slides fully off (`FLOATING_DOCK_OFF_GAP` past the edge, 250ms) then shrinks to a hittable strip (`FLOATING_DOCK_HIT_WIDTH` × `FLOATING_DOCK_HIT_HEIGHT`) flush with that edge. CSS paints a 6×72 gray capsule (`#dock-tab`, `#75757F`) with a soft glow and 1800ms opacity breath. Top and bottom never dock. Clamp while docked keeps the tab; clamp of a flush free-floating ball still does not dock. Tests skip the slide (`process.env.VITEST`).

`unsnapDockedBall` clears dock, places the 72px ball off-screen, and slides it in to a 5px inset (`FLOATING_DOCK_IN_PAD`, 300ms). The renderer waits 800ms after becoming docked, then a hover on the 20px inward hit strip (or a tab drag inward past `FLOATING_DOCK_DRAG_OFF`, one-third of the ball from the edge) calls `unsnap()`. That restores a normal ball; it does not keep a peek-while-docked state. Expanding the panel (`setFloatingExpanded(true)`) also clears dock.

A pinned panel cannot dock until the usual drag first collapses it. While the Computer Use session is running, a question card is up, or the TCC gate is visible, drag does not force-collapse and `move` / `clamp(..., canDock=false)` never dock.

## Alternatives considered

**Snap during the move.** Immediate mid-drag swap to a tab hides the ball under the pointer and fights the slide-off.

**Keep peek-while-docked after a 2s leave-and-reenter.** Hover should restore a normal ball, matching the slide-in, not a second docked size.

**Treat a flush work-area edge as docked.** Cold start already sits on the work-area right edge. Using display `bounds` plus a one-fifth overlap keeps that origin a full ball.

**Idle auto-snap while overlapping an edge without a drag.** Cold start and a parked flush ball must stay a 72px disk until the user drags in.

**Persist dock across restart.** Drag position is not stored; a tab after relaunch would surprise a user who expects the shipped 72px right-edge ball.

**Dock top and bottom.** The marker is a vertical capsule on the left or right edge only.

**A second BrowserWindow for the tab.** One overlay window already participates in overlay-guard capture omit; CSS hides the ball while docked.

## Consequences

The docked strip is still a visible overlay window, so overlay-guard capture omit and HID click-through keep using its CGWindowID. The hittable width includes a 20px inward strip along that edge. Running, asking, and TCC must pass `canDock=false` on move and clamp, because a collapsed ball can otherwise still cross the snap threshold on pointer-up.

## Testing

`floating-window.spec.ts` pins the one-fifth left/right threshold, no top/bottom dock, default origin and clamp not docking, snap on clamp, tab geometry, unsnap inset, expand clearing dock, drag-off, and `canDock=false`. `floating-renderer.spec.ts` pins 800ms then hover unsnap, and no force-collapse/`canDock=false` while running. `preload.spec.ts` and `main-startup.spec.ts` pin `floating.unsnap` plus move staying undocked until clamp returns `{ docked }`.
