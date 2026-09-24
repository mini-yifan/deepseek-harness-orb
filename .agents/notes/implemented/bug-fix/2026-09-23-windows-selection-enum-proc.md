# Agent Note: Windows selection enum callback is registered once

Status: implemented

English | [中文](2026-09-23-windows-selection-enum-proc.zh.md)

## Problem

Computer Use `input` begin calls `restoreLastFrontApp()`, which calls `activateWindowsPid`. That function called `koffi.proto` for `DshSelEnumProc` on every restore. Koffi keeps prototype names for the process, so the second call throws `Duplicate type name 'DshSelEnumProc'`. The overlay-guard handler treats any throw as a Host failure, and Desktop then shows the startup failure page while the session is already running.

## Decision

`DshSelEnumProc` and the Win32 functions that use it are created once per process. `activateWindowsPid` reuses them. The overlay-guard `input` begin handler logs a restore failure and still returns the overlay window ids, so a Win32 error does not stop the Host.

## Alternatives considered

**Catch the throw and leave `koffi.proto` inside `activateWindowsPid`.** The second restore would no longer take down the Host, and it would also stop bringing the previous app forward.

**Give each call a unique prototype name.** Koffi would keep every name until the process exits. A long Computer Use session would keep allocating callback types.

## Consequences

A later GUI action can restore the previous app again. A restore that still fails is written to the Desktop log and the cloak continues. macOS selection activation is unchanged.

## Testing

`apps/desktop/tests/windows-selection.spec.ts` calls `activateWindowsPid(0)` twice on Windows. The pid matches no window, so the test does not change the foreground.
