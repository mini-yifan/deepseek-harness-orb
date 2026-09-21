# Agent Note: Desktop selection toolbar in the Orb process

Status: implemented

English | [中文](2026-09-21-desktop-selection-in-process-identity.zh.md)

## Problem

Packaged DeepSeek Orb spawned `macos-selection` from `app.asar.unpacked`. That Mach-O is a second adhoc CDHash (`Identifier=macos-selection`), so Accessibility granted to the iconed `.app` does not trust the helper. The helper emits `untrusted` and never installs `NSEvent.addGlobalMonitorForEvents`, so Search / Translate / Send to Agent never appear. Unsigned packages key TCC by CDHash; two binaries cannot share one row. [Desktop ScreenCaptureKit in the Orb process](../architecture/2026-09-20-desktop-sck-in-process-identity.md) already recorded this split for capture.

## Decision

The Darwin selection monitor runs in the Electron main process. Desktop compiles `libmacos-selection.dylib` plus `macos-selection-napi.node`, unpacks both beside the ScreenCaptureKit addon, and delivers NDJSON lines through `napi_create_threadsafe_function`. `AXIsProcessTrusted` and the global mouse monitor therefore use Orb's Accessibility row. The `@_cdecl` library entry must not call `setActivationPolicy(.prohibited)`, or Orb would leave the Dock. [Desktop selection toolbar](../feature/2026-09-16-desktop-selection-toolbar.md) still owns toolbar UI, prompts, and enablement.

After installing a package that monitors in-process, fully quit (Cmd-Q) then reopen. A leftover `macos-selection` exec row in System Settings is the old helper and can be removed with "−".

## Alternatives considered

**Keep spawning the unpacked helper.** Live `/Applications/DeepSeek Orb.app` already spawned the unpacked binary; the helper stayed deaf because its CDHash is not the Orb row.

**Give the helper the app bundle id.** Unsigned adhoc TCC still keys CDHash, so two Mach-Os cannot merge.

**Load the helper through koffi.** Selection-toolbar packaging already rejected Electron plus koffi; asar, signing, and native-module policy keep a compiled N-API addon, the same path as overlay-exclude capture.

## Consequences

Signed and unsigned Desktop packages ask Accessibility only as iconed DeepSeek Orb for the selection toolbar. Packaged Electron no longer ships `lib/macos-selection` as an executable. The library path never changes Electron's activation policy.

## Testing

Swift source still contains CLI `setActivationPolicy(.prohibited)` on `@main`; the cdecl start path does not. Desktop tests pin the N-API threadsafe function, Darwin-only load, missing-addon skip, and electron-builder `asarUnpack` of the `.node` and dylib.
