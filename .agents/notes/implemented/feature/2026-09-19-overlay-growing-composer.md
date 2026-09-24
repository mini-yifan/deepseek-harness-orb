# Agent Note: Overlay composer grows around the ball

Status: implemented

English | [中文](2026-09-19-overlay-growing-composer.zh.md)

## Problem

The macOS overlay composer was a single-line `<input type="text">` in a 72px pill. The typed draft sat in about 196px beside the 72px ball, so a typical Computer Use instruction hid most of its characters behind horizontal scrolling. Cursor and the main-window composer wrap and grow; the ball did not.

[Desktop floating orb](2026-09-14-desktop-floating-orb.md) still owns overlay construction, 320×420 panel size, and the 72px ball origin. This note owns the overlay draft.

## Decision

`#prompt` is a `contenteditable` textbox in [`floating.html`](../../../../apps/desktop/renderer/floating.html). Empty and short drafts keep the grey pill at 72px. `--composer-height` grows toward the transcript by `--prompt-line` (20px) only when the current box overflows, up to `--composer-max` (`72px + 3 × 20px`). Compact Chat padding and the selection chip follow that height. The Electron window stays 320×420; the ball origin does not move.

`#prompt` has 12px vertical padding so glyphs do not kiss the pill. A `::before` float uses `height: var(--composer-height)` and a matching negative top margin so the exclusion still covers the 72px ball. `shape-outside: circle(36px …)` points toward the ball (`float: right` on `expand-left`, `float: left` on `expand-right`; circle at the bottom on `expand-up`, at the top on `expand-down`) plus 8px `shape-margin`. Lines that share vertical space with the avatar indent around it; lines away from the ball use the full pill width. Glyphs never paint under the circle. Once content exceeds the cap, `composer-capped` drops the float and applies `padding-inline` of `--ball` so a scrolling draft still clears the avatar.

Height is never measured by first stretching to `--composer-max`: a `height: 100%` float would then inflate `scrollHeight` to the cap, so even a few characters opened the tall pill.

Enter sends; Shift+Enter inserts a newline; IME composition (`isComposing` or `keyCode` 229) does not send. Paste inserts `text/plain` only. Placeholder copy stays `data-placeholder` plus `.prompt-empty`, because a contenteditable `:empty` rule breaks on Chrome's inserted `<br>`.

## Alternatives considered

**Keep `<input type="text">` and widen the panel.** A native input never wraps. Widening 320px still hides a long Chinese instruction on one line, and `FLOATING_PANEL_SIZE` is the overlay-guard geometry.

**A `<textarea>` with uniform `padding` equal to `--ball`.** Every line would stay as narrow as the column beside the ball, including the empty region above (or below) the avatar. `shape-outside` needs a formatting context that a textarea cannot share with the circle.

**Reuse the Web Lexical composer.** The overlay document stays `floating.html`; pulling `ui-conversation` would boot Client machinery the compact ball must not load.

**Grow the Electron window with the draft.** A taller always-on-top overlay covers more of the desktop Computer Use is driving. Height stays inside the 420px panel.

**Measure by first setting `--composer-height` to `--composer-max`.** The wrap float was `height: 100%`, so that stretch made `scrollHeight` equal the cap and every non-empty draft opened at the limit.

**A second popover editor on focus.** The pill would show a truncated line while a larger box showed the same text. Two copies of the draft.

## Consequences

A long paste scrolls inside the 132px cap instead of growing the overlay. jsdom does not prove circular wrap; Chromium layout is a manual check. `#prompt` is no longer a labelable form control; the visually hidden label uses `aria-labelledby`.

## Testing

`floating-renderer.spec.ts` pins `contenteditable` markup, `--composer-max`, `--prompt-pad`, `--composer-height` on the pill, chip, and wrap float, float/`shape-outside` per expand class, capped padding, a short draft staying at 72px, line-at-a-time growth (no measure-at-max), Enter vs Shift+Enter vs composing Enter, and paste of `text/plain` without HTML. Existing overlay send paths set the contenteditable text instead of `input.value`.
