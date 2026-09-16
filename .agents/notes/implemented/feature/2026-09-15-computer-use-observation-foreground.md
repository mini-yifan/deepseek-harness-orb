# Agent Note: Computer Use observation foreground

Status: implemented

English | [中文](2026-09-15-computer-use-observation-foreground.zh.md)

## Problem

A Computer Use observation already attaches screens, but the model cannot tell which app is focused or which Finder folder is open. POLICY forbids OCR of file paths from pixels, so Finder work has no trustworthy path. Overlay chrome is skipped in capture; without a matching inspect skip, the text would name the floating ball as frontmost.

## Decision

`observeDesktop` calls `DesktopBackend.inspectForeground` once and captures the overlay-skipped frontmost window when `listScreens` returns that surface. The model-facing content is one foreground text block followed by the window envelope and image when a window remains. Overlay skip uses `activeCaptureExcludeWindowIds()` (the ball and expanded panel share that window). The inspect path does not skip the Electron PID. If the Desktop main window is next in z-order, `<frontmost_app>` is that window's localized name (typically DeepSeek Harness) and fallback is not used. [Computer Use focused-window observation](2026-09-16-computer-use-focused-window-observation.md) owns window capture, optional `<frontmost_window>`, and the empty-frontmost path that attaches no desktop panorama.

When the remaining owner is `Finder` or `访达`, a second osascript reads `POSIX path of (target of front window as alias)` into `<frontmost_folder>`. Timeout or empty omits the folder tag and keeps the app name. When no remaining window has an owner name, the envelope is `<frontmost_app>none</frontmost_app>` plus `<focus_note>`. Empty tags are omitted. Screenshot filesystem paths are never emitted. Finder paths are never invented.

Those tags ride existing `user/message` (first-frame plugin notice) and `tool/result` content. There is no new session event, no `ignorable` flag, and no `SESSION_FORMAT_VERSION` bump. `SCREEN_SCHEMA` stays unchanged (`additionalProperties: false`). Structured `foreground` is a sibling field on each GUI tool output so `output.render` can format it.

macOS JXA implements inspect over on-screen layer-0 windows and also returns window id, global bounds, and optional title for capture. The fake backend defaults to `{ appName: 'Pages' }` so the authored snapshot pins a stable tag without a folder. The unsupported backend throws the same macOS-only error. `wrapDesktopBackend` runs inspect and `listScreens` inside `withCapture` so exclude ids are live; `openApp` uses `withInput`; `listApps` and the other `open_*` methods stay unwrapped. Query or parse failures return the focus fallback and must not fail `observeDesktop`. Abort still fails the observation.

[Experimental Computer Use](2026-09-13-experimental-computer-use.md) still owns the GUI tools, first-frame attach, and the consent gate.

## Alternatives considered

**Skip the Host Electron PID.** Computer Use runs in the Desktop Host Node child; overlay and main windows belong to Electron. PID skip would hide DeepSeek Harness even when that window is the next operable target after the overlay.

**CoView-style last-external-app tracker.** If the overlay is focused and the main window sits above Chrome, overlay-only skip reports DeepSeek Harness. A tracker that remembers the last non-harness app is a later cut.

**New `computer-use/foreground` session event.** Observation is already model-visible on `user/message` and `tool/result`. A new event would bump format machinery without a new reconstructability need.

**Put `foreground` on `SCREEN_SCHEMA`.** Foreground is one fact per observation, not per display. The screen object forbids extra properties.

**Window title, Office document path, or other apps' folders.** This note shipped app name, Finder folder, and focus fallback. Optional `<frontmost_window>` is owned by [Computer Use focused-window observation](2026-09-16-computer-use-focused-window-observation.md).

## Consequences

Every observation spends a few tokens on OS metadata. Finder folder lookup needs Automation for Finder; a missing grant omits the folder and keeps the app name. Overlay-only skip can name the Desktop main window as `<frontmost_app>`. Inspect failures still attach the frontmost window when one remains, with fallback tags; empty frontmost attaches no panorama.

## Testing

Package tests inject a CommandRunner for overlay-id skip, Finder/访达 folder, omitted folder, and fallback; observe/tools tests pin the tags and still omit `<path>`; overlay-guard tests run inspect and `listScreens` inside `withCapture`; loop and pre-step tests require `<frontmost_app>` on the first-frame notice and the click result. The authored [`snapshots/session/computer-use/session.v3.jsonl`](../../../../snapshots/session/computer-use/session.v3.jsonl) pins fake `Pages` on first-frame and click; Finder and fallback stay unit-tested.
