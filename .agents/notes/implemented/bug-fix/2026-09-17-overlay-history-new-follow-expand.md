# Agent Note: Overlay History and New follow the input-pill edge

Status: implemented

English | [中文](2026-09-17-overlay-history-new-follow-expand.zh.md)

## Problem

History and New are `position: absolute; top: 12px` on the overlay panel. When the ball is high enough that the overlay grows down, the input pill and avatar occupy that same top band, so the two controls paint under the composer.

[Desktop floating orb](../feature/2026-09-14-desktop-floating-orb.md) still owns overlay construction, expand direction, and what History / New do. This note owns where those two buttons sit relative to the pill.

## Decision

History stays left and New stays right. Their vertical edge is the transcript side opposite the input pill: `top: 12px` for `expand-up`, `bottom: 12px` for `expand-down`. `expand-down` also swaps `#panel` padding so the pill's 72px band is the top inset, and moves the 36px transcript / history-list / question padding to the bottom so the last rows clear the buttons.

## Alternatives considered

**Raise z-index and keep the buttons at the top.** They would still sit on the composer and cover the prompt.

**Put History and New on the input pill.** That shares the drag, pin, and Stop corner the pill already owns.

## Consequences

Horizontal placement does not follow `expand-left` / `expand-right`. Unpinning and collapse keep the current expand-direction classes, so the buttons stay on the opposite edge until the next expand.

## Testing

`apps/desktop/tests/floating-renderer.spec.ts` pins History left, New right, `top: 12px` by default, `bottom: 12px` under `expand-down`, and the swapped panel and transcript padding for downward growth.
