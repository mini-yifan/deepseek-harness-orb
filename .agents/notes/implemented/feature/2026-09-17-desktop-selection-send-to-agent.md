# Agent Note: Desktop selection Send to Agent

Status: implemented

English | [中文](2026-09-17-desktop-selection-send-to-agent.zh.md)

## Problem

macOS users who drag-select text in another app want to give the floating-ball agent their own instruction for that quote. Agent Explain immediately queued a fixed “Explain this text” Computer Use turn, skipped the first-frame screenshot, and never used the overlay composer. Users who then typed in that same input would treat the third toolbar button as a special case unlike a normal send.

## Decision

The selection toolbar’s third button is **Send to Agent**. Search and Translate are unchanged. [Desktop selection toolbar](2026-09-16-desktop-selection-toolbar.md) still owns helper, geometry, Bing, and Translate. Send to Agent hides the toolbar, expands the overlay, focuses it, and pushes the full selection on `selectionAttach`. The overlay stores that string as composer state and shows a one-line chip flush against the transcript-side edge of the input pill (`expand-up` above, `expand-down` below). Overflow uses CSS ellipsis; the stored string stays complete. A dismiss control clears the chip. Overlay chrome (New, History, Access) does not. A later Send to Agent replaces the quote.

The first composer Enter joins `instruction + "\n\n" + selection` through the ordinary overlay `session/prompt` path and then clears the chip. That user message does not start with `Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.`, so Computer Use keeps first-frame capture and may call GUI tools or `code_agent`. Later Enter sends are ordinary composer text. An empty instruction does not send.

Translate still restores the selection’s front app with `showInactive` and the overlay-owned `activate` suppression. Send to Agent uses the same 2s main-window suppress, focuses the overlay, and does not `activate-pid`. `floatingSetExpanded` restores the front app only while that Translate restore-front window is live; attaching clears it so expansion cannot steal the keyboard. Chip presence blocks auto-collapse the way a running or asking overlay does. The overlay is not auto-pinned.

## Alternatives considered

**Keep immediate Explain.** A fixed explain prompt cannot carry “polish” or “shorten”, and skipping the first frame made the third button unlike every other composer send.

**Keep the chip across later sends.** The quote would silently prefix every follow-up. Clearing on the first Enter matches a one-shot attachment.

**Skip first-frame capture like Translate.** Users type in the same input as a normal task and expect a screenshot. The Translate preamble remains the skip signal.

**Auto-pin the overlay.** Pinning changes chrome the user did not click. Blocking collapse while the chip exists is enough for typing.

**Persist the chip in `floating-session.json`.** Restart should not resurrect a quote from another app. Renderer memory is enough.

## Consequences

Translate remains the only toolbar action that omits the first frame. Changing the Send to Agent join or focusing the overlay without clearing restore-front will either drop the quote, steal the previous app, or pop the main window. Accessibility is still required for the toolbar to appear.

## Testing

Desktop tests cover attach IPC vs Translate prompt, no `activate-pid` on Send to Agent, overlay focus without restore-front on expand, chip ellipsis CSS and expand-up/down placement, New Chat keeping the chip, dismiss, first Enter joining instruction and full selection then clearing, and a second Enter without the quote. Computer Use preamble skip tests are unchanged and still belong to Translate.
