# Agent Note: Computer Use same-step GUI calls

Status: implemented

English | [中文](2026-09-19-computer-use-same-step-gui-calls.zh.md)

## Problem

Computer Use policy told the model to take exactly one GUI action per tool call and not to combine GUI tools in the same step. Four clicks on a still canvas then a hotkey therefore cost four extra vision roundtrips. The host already serializes exclusive siblings in one assistant step and attaches a screenshot to each result.

## Decision

Step copy in [`policy.ts`](../../../../packages/experimental/tool-computer-use/src/policy.ts) lets the model emit several GUI tool calls in one step when every target is already visible in the latest screenshot and later calls do not need UI that earlier calls create. The host runs those calls in order. Each result includes its own post-action screenshot; after the step, the last image is the one to use for any action that depends on what changed. A click, type, or hotkey whose target appears only after an earlier action in the same step (menu, dialog, new page, loader) stays in a later step.

GUI tools remain `isConcurrencySafe: () => false`. `execute`, `guiTurn`, overlay-guard, and `withGuiTurn` still wrap one action plus its recapture. Model-visible descriptions omit `Exclusive` and `do not combine`; that classifier stays host-only. [Experimental Computer Use](2026-09-13-experimental-computer-use.md) still owns the plugin, the thirteen GUI tools, and the one-action-then-recapture path.

## Alternatives considered

**Coalesce recapture onto the last sibling.** That would skip intermediate capture and image tokens, but it changes execute, `withGuiTurn`, and the per-call screenshot result. This cut keeps one recapture per call.

**Mark `click` parallel-safe.** One pointer and one overlay cloak cannot overlap HID. Exclusive scheduling already queues same-step siblings.

**Keep one GUI call per step.** That avoids stale-coordinate batches, and it also keeps the extra vision roundtrips on a still canvas.

## Consequences

A batch whose second call needs a control that the first call creates will miss. The next model request carries one image per sibling until compaction. HID settle `postActionWaitMs` still runs after every call.

## Testing

Package tests pin the Step phrases, omit `Exclusive` / `do not combine` from millifraction and pixel `click` descriptions, keep `executionMode` exclusive, and run two same-step `click` calls through the agent loop: ordered fake-desktop HID, two `tool/result` images, and both images on the next request. Headless snapshot sidecars pin the system-prompt Step paragraph and tool-schema descriptions.

## Deferred

A later cut may hold overlay click-through across a same-step burst and recapture only after the last GUI call. That is not this decision.
