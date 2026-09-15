# Agent Note: Computer Use wait and long_wait

Status: implemented

English | [中文](2026-09-15-computer-use-wait-and-long-wait.zh.md)

## Problem

Computer Use `wait` took a free `wait_seconds` number defaulting to 1 and clamped by Config `maxWaitSeconds` 5. Models treated that ceiling as the intended pause and routinely chose 3–5 seconds for ordinary loaders. A 1-second recapture is already long for a spinner; a 5-second empty pause is worse. Download, install, and on-screen generation still need tens of seconds to minutes. [Experimental Computer Use](2026-09-13-experimental-computer-use.md) still owns the plugin and exclusive GUI path.

## Decision

`wait` takes no arguments and always pauses 1 second, then recaptures. Use it when the latest screenshot still shows a loader, spinner, or a control that has not appeared. Click and open already return a new screenshot, so do not immediately `wait` unless that image still shows loading.

`long_wait` requires `wait_seconds` in `{10, 30, 60, 120}`. Missing or off-enum values fail loud. Use it only for a visible long job (download, installer, export, in-window generation). Pick the smallest bucket that covers remaining progress; 120 only when the screenshot already shows a minutes-long job. The 10-second floor is the product invariant that keeps ordinary refresh on `wait`. Both tools are exclusive GUI recapture; `delay()` still honors abort.

`maxWaitSeconds` is removed. The 1-second pause and the four buckets are not cordis Config. Policy and `code_agent` tell the model not to poll a Code session with `wait`, `long_wait`, or bash sleep.

## Alternatives considered

**One `wait` with 1–120 seconds.** Models max out a continuous range. The 4–5 second habit would move to 60 and 120.

**A 5–15 second middle tool.** That reopens short “insurance” pauses. The gap is filled by repeating `wait` or paying the 10-second `long_wait` cost.

**CoView `page_loading` pixel settle.** This package keeps a fixed `postActionWaitMs` after HID/open and does not stall on pixel diff.

**Default `long_wait` to 60 or omit seconds.** Omitting must fail. A default of 60 would recreate ceiling-seeking.

## Consequences

The Computer Use catalog is eleven exclusive GUI tools plus `code_agent`. Ordinary loaders cannot request 3–5 seconds. A remaining 8-second download either loops `wait` or overshoots with `long_wait` 10. Overlay-guard is unchanged: neither tool posts HID.

## Testing

Package tests spy `delay` so execute does not wall-clock sleep. They cover `wait` always 1s, `long_wait` each bucket, omitted and off-enum `wait_seconds`, text-only refusal, exclusive mode, `presentCall`, GUI schema lists, and removal of `maxWaitSeconds`. The authored [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) header pin refreshes `system-prompt.expected.md` and `tool-schemas.expected.json`.
