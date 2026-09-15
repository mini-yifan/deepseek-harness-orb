# Agent Note: Computer Use pointer and open tools

Status: implemented

English | [中文](2026-09-15-computer-use-pointer-and-open-tools.zh.md)

## Problem

The Computer Use preset could click, type, scroll, hotkey, and wait, but it could not press-and-hold, drag, open the user's visible browser, or open a known file or folder. Models OCR Desktop icons, call `web_fetch` instead of showing a window, or substitute `bash` `open`. [Experimental Computer Use](2026-09-13-experimental-computer-use.md) still owns the plugin, preset, and consent gate.

## Decision

Four more exclusive GUI tools follow the existing one-action-then-recapture path and fail at execute on text-only routes.

`long_press` takes `screen_index`, `position` in 0–1000, and optional `duration_seconds` (default 3, inclusive 1–10). The bound is a HID safety invariant, not a cordis Config. macOS posts `longPressAt` (left down, sleep, left up).

`drag` takes start and end screen indexes and 0–1000 positions. Cross-screen is allowed. macOS posts `dragFromTo`: move, left down, ten LeftMouseDragged (type 6) steps, left up. Step count stays inside [`HID_RUNTIME`](../../../../packages/experimental/tool-computer-use/src/macos.ts).

`open_in_browser` and `open_in_finder` launch through `/usr/bin/open`, not HID. Omit `url` to launch the default HTTP handler (`open -b` after LaunchServices lookup). A present URL must be http(s); a missing scheme becomes `https://`; userinfo is rejected; CJK in path or query must be plain text, never multi-byte percent-encoding such as `%E5...` / `%E8...`. This is the user-visible browser. `web_search` / `web_fetch` stay model-side text.

`open_in_finder` expands `~`, `realpath`s, and rejects CoView-style prefixes (`/System`, `/private`, `/etc`, `/var`, `/usr`, `/sbin`, `/bin`, `/dev`, `/proc`, `/sys`). Omit `path` to open `~/Desktop`. A directory opens in Finder. A file opens with the default app unless `reveal_only` is true, which runs `open -R`. `reveal_only` is ignored for directories. A missing path fails loud. Result text includes the resolved path so the model does not OCR. There is no directory-preview listing.

[`wrapDesktopBackend`](../../../../packages/experimental/tool-computer-use/src/overlay-guard.ts) cloaks `longPress` and `drag` with `withInput`. `openInBrowser` and `openInFinder` stay unwrapped because they do not post HID. Recapture still uses `withCapture`.

Policy tells the model: known path → `open_in_finder`; visible site → `open_in_browser`; sliders, window moves, file drags → `drag`; press-and-hold → `long_press`; do not substitute `bash` `open` or `web_fetch`.

## Alternatives considered

**`bash` `open` as the open path.** That hides the launch from GUI exclusive mode, skips recapture, and bypasses the URL and path checks.

**Split `open_file` / `open_folder`.** One tool with optional `path` and `reveal_only` matches the CoView call the model already knows, and omit-path Desktop is one schema.

**Directory-preview listing on `open_in_finder`.** That is `manage_files` work. This cut returns the resolved path and a screenshot.

**HID click on Dock or Desktop icons.** Opening a known path or URL does not need pixel hunting, and overlay chrome would interfere.

**`launch_app`, `capture_screen`, and `manage_files` in this cut.** Those are separate CoView tools. Observation is already first-frame plus every GUI result; app launch and file management stay deferred.

**cordis Config for hold duration or drag steps.** The 1–10 hold bound is a HID safety invariant. Drag step count is an implementation constant in `HID_RUNTIME`.

## Consequences

The Computer Use catalog is nine exclusive GUI tools plus `code_agent`. `open_*` can raise windows the overlay does not cloak. The path blacklist includes `/private`, so macOS `/tmp` after `realpath` is forbidden. CJK percent-encoding fails at execute with a model-facing diagnostic.

## Testing

Package tests cover execute/render, exclusive mode, schema names, invalid duration/URL/path, text-only refusal, JXA containing `longPressAt` / `dragFromTo`, `/usr/bin/open` argv for URL, default browser, Desktop, file, and `open -R`, overlay wrap split, unsupported methods, and path/URL helpers. The authored [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) header pin refreshes `system-prompt.expected.md` and `tool-schemas.expected.json`. Replay still uses a fixture PNG.
