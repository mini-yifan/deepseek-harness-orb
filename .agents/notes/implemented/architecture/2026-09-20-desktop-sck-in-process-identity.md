# Agent Note: Desktop ScreenCaptureKit in the Orb process

Status: implemented

English | [中文](2026-09-20-desktop-sck-in-process-identity.zh.md)

## Problem

Packaged DeepSeek Orb showed two Screen Recording rows: the iconed `.app` (Electron) and a generic exec (`macos-sck-capture`). Overlay TCC probes the Electron process. Overlay-exclude capture spawned the helper, so a grant on the iconed row still failed ScreenCaptureKit as a different TCC client. Adhoc unsigned packages key TCC by cdhash, so two Mach-Os cannot share one row. Signed packages still listed a second identifier because the helper lives under `signIgnore` `dsh/` and is not `ai.deepseek.orb`.

## Decision

Overlay-exclude ScreenCaptureKit runs in the Electron main process. Host protocol 8 carries ack'd `sck-capture` / `sck-capture-ack`. `ComputerUseOverlayGuard.captureExcludedRegion` is the Desktop path; CLI still execs `macos-sck-capture` so that grant stays on Terminal or the calling host. The Swift capture is shared: the CLI `@main` entry still sets `NSApplication` activation policy to `.prohibited`; the `@_cdecl` library entry must not, or Orb would leave the Dock. Desktop compiles an ABI-stable N-API `.node` plus `libmacos-sck-capture.dylib`, unpacks them beside `macos-selection-napi.node`, and calls capture through `napi_create_async_work` so the MainActor hop cannot deadlock Electron's main thread. [Desktop overlay-guard IPC](2026-09-14-desktop-overlay-guard.md) owns cloak intervals, exclude ids, and the observation-frame ribbon.

After installing a package that captures in-process, fully quit (Cmd-Q) then reopen. A leftover exec row in System Settings is the old helper and can be removed with "−".

## Alternatives considered

**Hide the overlay then use `desktopCapturer`.** The ball and observation-frame ribbon would flash off during every shot.

**Give the helper the app bundle id or the same Developer ID Team.** That still leaves a second Mach-O. Unsigned adhoc TCC keys cdhash, so two binaries cannot merge.

**Load the helper through koffi in Electron.** Selection-toolbar packaging already rejected Electron plus koffi; asar, signing, and native-module policy keep a compiled N-API addon.

## Consequences

Signed and unsigned Desktop packages ask Screen Recording only as iconed DeepSeek Orb for overlay-exclude capture. CLI Computer Use still shows the helper under Terminal. `dsh/` extra still carries the CLI helper. The library path never changes Electron's activation policy.

## Testing

Helper source still contains CLI `setActivationPolicy(.prohibited)`; the cdecl entry calls capture with `startCliApplication: false` and does not set activation policy. `macos.ts` spawns the helper when `captureExcludedRegion` is omitted and does not when it is provided. Host and Electron tests pin sck-capture success, failure ack without a fatal Host event, timeout, abort, and protocol 8. Packaging tests pin asarUnpack of the `.node` and dylib next to `macos-selection-napi.node`.
