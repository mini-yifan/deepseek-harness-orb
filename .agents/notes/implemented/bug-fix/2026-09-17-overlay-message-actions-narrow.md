# Agent Note: Overlay message actions stay clickable on a long clock

Status: implemented

English | [中文](2026-09-17-overlay-message-actions-narrow.zh.md)

## Problem

The 320px floating-orb Compact Chat iframe shows IconActions under each settled message. Same-day clocks are `HH:mm`; other days prepend `clock.md` / `clock.ymd` (`9月16日 16:23`). That longer label, plus copy, like, dislike, branch, and collapsed stat pills, overflowed the row. Flex items shrank below 28px and nowrap clock text painted over neighbors, so hits missed the intended control.

Copy also wrote nothing: the shell is `dsh-app://shell` and the transcript iframe is `dsh-app://app`, so `navigator.clipboard.writeText` needs `allow="clipboard-write"`. Without it the write rejected, `writeClipboard` returned false, and IconActions showed no check. Like/dislike called `openDialog` with no `conversation.input.overlay` host, so FeedbackDialog never mounted.

[Overlay Compact ChatView](../feature/2026-09-16-overlay-compact-chat.md) still owns the iframe and Compact Chat root. This note owns the IconActions row, overlay clipboard permission, and the overlay `conversation.input.overlay` seat.

## Decision

Icon buttons (`MessageIconActions` copy/branch and `MessageFeedbackActions` ratings) use `flex: none`. The clock is the overflow absorber: `min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis`, still one 28px row. Below 480px, collapsed Turn usage/time pills are also `flex: none`. The row itself is `max-width: 100%`.

The overlay iframe sets `allow="clipboard-write"`. `writeClipboard` still prefers `clipboard.writeText`; a rejection falls through to `execCommand('copy')`. OverlayChatRoot declares and renders `conversation.input.overlay` as a zero-size host so FeedbackDialog's body-portaled Modal can mount. The floating-ball shell still owns the composer.

## Alternatives considered

**Wrap the clock onto a second line.** That would keep the full date but change the 28px Figma row on every narrow column, including the main window.

**Hide the clock on `?surface=overlay`.** The same overflow exists in any narrow Compact column; the shared ellipsis is the one rule.

**Desktop clipboard IPC.** Extra preload surface for a Web Clipboard Policy miss. `allow` plus `execCommand` is the existing helper's second path.

**Leave like/dislike dead on overlay.** The buttons are visible; a missing overlay seat made them look unclickable.

## Consequences

A not-today clock may ellipsize (`9月16日…`) instead of wrapping. Overlay still has no composer; input-overlay entries other than FeedbackDialog that assume a composer card get a zero-size host.

## Testing

`chat-font-axis-styles.client.spec.ts` pins `flex: none` on `.action`, clock ellipsis, row `max-width: 100%`, and narrow-viewport pill `flex: none`. `chat-branch-tails.client.spec.tsx` renders a not-today user clock next to copy. `MessageFeedbackActions` style specs pin `flex: none`. `writeClipboard` tests cover reject-then-execCommand and reject-with-no-fallback. Desktop `floating-renderer.spec.ts` pins iframe `allow="clipboard-write"`. `ui-overlay-chat` specs pin `conversation.input.overlay` on overlay root and the OverlayChatRoot render call.
