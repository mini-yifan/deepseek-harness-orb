# Agent Note: Desktop overlay-guard IPC

Status: implemented

English | [中文](2026-09-14-desktop-overlay-guard.zh.md)

## Problem

Computer Use capture and HID run in the Desktop Host child. The macOS floating overlay is an always-on-top Electron panel (ball and expanded transcript share that window). Standing `contentProtection` on both Desktop windows hid the Harness UI from the agent and also hid the ball from every other capture. Standing click-through would steal the user's input box. Host Node IPC accepted only `ready` / `fatal` / `shutdown`; an unknown event killed the child. Overlay renderer IPC cannot see Computer Use sessions started from the main window. `/usr/sbin/screencapture` on macOS 15.4+ uses ScreenCaptureKit, which ignores `NSWindowSharingNone` (`contentProtection`), so a capture-time protection bit cannot omit the overlay from the framebuffer.

## Decision

Desktop Host protocol version is 5. Pipe `FRAME_MAGIC` stays `0x44534833` because the byte-pipe layout did not change. Node IPC adds an ack'd `overlay-guard` event (`begin` | `end`, `mode: capture` | `input`) and an `overlay-guard-ack` command that carries `excludeWindowIds`. Electron applies HID click-through when `mode` is `input`, waits `OVERLAY_GUARD_INPUT_APPLY_MS` (80) so WindowServer commits hit-testing, then acks even when no overlay exists (`excludeWindowIds: []`). On capture begin it reports the overlay `getMediaSourceId()` CGWindowID. After HID returns, Host waits `OVERLAY_GUARD_INPUT_DRAIN_MS` (80) then `finally` always sends `end`. Electron restores overlay chrome on Host exit. The ack wait is `OVERLAY_GUARD_ACK_TIMEOUT_MS` (1000).

The main window never sets `contentProtection` or `ignoreMouseEvents`. The overlay stays drawn and hittable by default. Capture does not set `contentProtection`. `input` mode sets `setIgnoreMouseEvents(true, { forward: false })` and `blur()` on the whole overlay window only for that interval. `postActionWaitMs` runs uncloaked.

When `excludeWindowIds` is non-empty, Computer Use capture runs the Darwin ScreenCaptureKit helper (`SCContentFilter` `excludingWindows`, `SCScreenshotManager.captureImage`, cursor on, JPEG out) instead of `/usr/sbin/screencapture`. A missing overlay window in shareable content fails the capture; it does not fall back to `screencapture`. CLI and other hosts with an empty id list keep `screencapture`.

Computer Use stays Electron-agnostic: `wrapDesktopBackend` wraps `capture` in `withCapture` (ids stored for the macOS backend) and HID in `withInput`; `listScreens`, `openInBrowser`, and `openInFinder` are unwrapped. Production `apply` uses `ctx.get('computerUseOverlayGuard')` and skips the wrap when the service is absent. Desktop copies the built `lib/index.js` extra and refuses a bundle that lacks that wrap. `start:desktop --skip-build` still rebuilds Desktop Host, the Electron shell, and this experimental package so `withCapture` cannot call `run()` without window ids. Desktop Host overlay YAML inserts `computer-use-overlay-guard`, which provides that service and must not import the experimental package. Only Computer Use declaration-merges the optional Context key, so the Host typecheck does not collide two `ComputerUseOverlayGuard` types. Index and the YAML plugin share one overlay-guard module instance so pending acks are not split across bundles. See [Desktop floating orb](../feature/2026-09-14-desktop-floating-orb.md).

## Alternatives considered

**Standing `contentProtection` on both windows.** That hid the Harness UI from the agent and hid the ball from user screenshots and meeting capture at all times.

**Hide or fade the overlay during capture.** The user would see the ball flash away.

**Capture-interval `contentProtection` only.** ScreenCaptureKit display capture on macOS 15.4+ still includes the window, and a protected window can vanish from `SCShareableContent.windows` so it cannot be excluded by id.

**Private `CGSSetWindowCaptureExcludeShape`.** That would keep `/usr/sbin/screencapture` but is not a public API.

**Overlay renderer IPC.** Computer Use on the main window would not cloak the ball.

**Host-initiated Fetch pipes.** Pipes are Electron-initiated Fetch only. Node IPC already carries control messages. Screenshot bytes do not fit the overlay-guard ack.

**Wrapping `plugin.ts` execute.** First-frame capture is `agent/pre-step`, and wrapping execute would hold the cloak through `postActionWaitMs`.

## Consequences

Mixed Electron/Host shells fail at `ready` instead of on the first cloak. A lost `end` is recovered when the Host child exits. Concurrent Computer Use sessions share overlay refcounts. Keyboard focus can still land in the overlay outside an `input` interval; `input_text` click-through is what steals focus to the window below. Web and CLI Computer Use stay uncloaked. Darwin Desktop extra copies include `lib/macos-sck-capture` when that helper was compiled.

## Testing

Electron tests pin default `contentProtection === false` during capture begin, overlay `getMediaSourceId` window ids on capture ack, input begin `ignoreMouseEvents({ forward: false })`, async overlay-guard callbacks that ack only after the promise resolves, Host-stop restore, overlay-guard IPC that is not fatal, and protocol 4 ready rejection. Desktop Host tests pin overlay YAML insert, pass-through without a sender, begin ack window ids reaching `withCapture`, throw restore, abort restore, ack timeout, `withInput` drain before `end`, and `apply` plus installed transport. Computer Use tests pin `wrapDesktopBackend` capture vs HID vs `listScreens` vs unwrapped `open_*`, forwarded exclude ids, restore on throw, `apply` wrapping on a child context, helper argv when ids are set, no `screencapture` fallback, and extra copy rejection without wrap.
