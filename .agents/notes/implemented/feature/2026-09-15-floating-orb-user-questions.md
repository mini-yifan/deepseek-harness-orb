# Agent Note: Floating orb user questions

Status: implemented

English | [中文](2026-09-15-floating-orb-user-questions.zh.md)

## Problem

The macOS overlay is a shell page whose Compact transcript lives in a `?surface=overlay` iframe. Computer Use asks through `ask_user_question`, which waits on a live `'user-questions/request'` waterfall. Pending questions are not session events, so the ball cannot reconstruct them from ChatView. The iframe is a third Gateway Client; if it also claimed the waterfall, a closed main window would still have two overlay answerers.

## Decision

The overlay opens the Desktop Host `$events` stream at `dsh-app://app/.dsh/remote-stream` after Host ready, using the same NDJSON carrier as the injected main-window `__DSH_TRANSPORT__.openStream`. It replies with `$events/result`. It claims a `user-questions/request` waterfall when `agentId` is a Computer Use session the ball has created or adopted, and immediately returns `next()` for every other waterfall. A claimed request stays held across History switches until the user answers or cancels, or the Host sends `cancel`. Gateway still fans the waterfall to every Client; the first `result` or `rejected` wins. The Compact Chat iframe also loads `ui-user-questions` and always `next()`s, so vanilla `floating.js` remains the overlay claimer; [overlay Compact ChatView](2026-09-16-overlay-compact-chat.md) owns that iframe.

The expanded panel renders a compact vanilla HTML card: question text, optional header and detail, single-select and multi-select options, a custom textarea, skip, pager, and dismiss. Answers use the same JSON as the Web composer. `plan-review` uses that generic option list. Arrival expands the panel and blocks hover-collapse the same way a running session does. The overlay document stays `floating.html`; Compact ChatView loads in a transcript iframe. See [Desktop floating orb](2026-09-14-desktop-floating-orb.md) for overlay construction.

## Alternatives considered

**Loading the packaged Web client as the overlay document.** That would reuse `QuestionComposer` but would also boot the mode picker the compact ball must not show. The [orb decision](2026-09-14-desktop-floating-orb.md) already rejected this. The transcript iframe `next()`s the same waterfall instead of presenting a second card.

**Projecting the pending question from `session/page`.** The user-questions seam publishes no independent request/answer audit stream. Only the later `tool/call` and `tool/result` appear in the log, so a pending wait cannot be reconstructed.

**A Host RPC that lists pending questions for the overlay to poll.** That would duplicate the waterfall and still require `$events/result` to settle it. Opening `$events` on the existing Desktop stream carrier is the Client protocol.

## Consequences

The overlay is a second Gateway Client. Closing the main window leaves Computer Use questions with an overlay answerer. Answering on the ball cancels the main-window card, and answering in the main window dismisses the ball card. The Compact Chat iframe does not claim the waterfall. Per-click Computer Use approval remains absent. Overlay renderer tests drive a mocked NDJSON `$events` stream for claim, option submit, custom text, skip, cancel, `next()` for other agents, Host `cancel`, and History switch-and-return.
