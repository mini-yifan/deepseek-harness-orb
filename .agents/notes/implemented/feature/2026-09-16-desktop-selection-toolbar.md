# Agent Note: Desktop selection toolbar

Status: implemented

English | [中文](2026-09-16-desktop-selection-toolbar.zh.md)

## Problem

macOS users select text in other apps and expect Search, Translate, and an agent action on that quote without opening a new session. The floating ball had no selection toolbar. A Cordis capability seam, a session-format field, or importing the experimental Computer Use package from the Electron app would either widen the product API or violate the release-app naming rule.

## Decision

macOS Desktop owns the feature in the Electron shell. A Darwin monitor (`apps/desktop/src/macos-selection.swift`, loaded in-process through `macos-selection-napi.node`) watches left-button drags longer than 8px, then reads `AXSelectedText` (and selection bounds) or falls back to clipboard `Cmd+C` with backup and restore. It ignores the Electron PID. Selection payloads always include the mouse-up point. The toolbar sits 8px below that point, not the AX rectangle: browsers often report window-local or chrome-origin `kAXBoundsForRangeParameterizedAttribute` rects that would pin the bar at the window top-left. A 3s `pid + bundle + text` dedupe, a left mouse-down outside the toolbar window, any key, right or middle mouse-down, a non-momentum scroll, and a new drag hide the toolbar. The monitor does not emit `key` for the `Cmd+C` it posts during clipboard fallback, and trackpad inertia (`momentumPhase`) does not hide, so leftover scrolling after a drag-select cannot dismiss the bar. Accessibility off emits `untrusted` and does not tap; the first untrusted event opens System Settings via `systemPreferences.isTrustedAccessibilityClient(true)`. The controller then polls trust and restarts the monitor once Accessibility is granted, without a relaunch. Windows does not start the monitor.

The monitor is an N-API addon in the Electron process (`asarUnpack: lib/macos-selection-napi.node` and `lib/libmacos-selection.dylib`), not a spawned executable. [Desktop selection toolbar in the Orb process](../architecture/2026-09-21-desktop-selection-in-process-identity.md) owns that identity: a child Mach-O is a second Accessibility CDHash, so Search / Translate / Send to Agent never appear after a grant on the iconed Orb row.

A third `type: 'panel'` window loads `dsh-app://shell/selection-toolbar.html` without activating Desktop. Copy is locale-owned. Preferences persist as `selection-toolbar.json` next to `floating-session.json` (`enabled: true`, `translateTargetLanguage: 'zh'` by default). Overlay right-click and the [Desktop orb Settings](2026-09-18-desktop-orb-settings.md) switch toggle enablement.

Search opens `https://www.bing.com/search?q=` plus the encoded selection in the default browser and does not prompt the agent. Translate hides the toolbar, expands the ball, and `session/prompt` `mode: 'queue'` the current overlay Computer Use session. Translate must not show or focus the main window, and must not keep Desktop as the frontmost app: toolbar IPC ignores `app` `activate` for 2s, the overlay expands with `showInactive`, the toolbar hides after that send, a focused main window `blur()`s, and the in-process monitor `activatePid` re-activates the selection's process (the Electron pid is skipped). Search leaves focus with the browser. Dock `activate` after that interval still shows the main window. Overlay button clicks are not that interval. [Desktop overlay click keeps the front app](../bug-fix/2026-09-22-desktop-overlay-click-keeps-front-app.md) owns them. Opening the language menu resizes the toolbar panel around the compact bar origin (down, or up when the work area would clip it) and closing it restores the compact size so transparent chrome does not eat clicks. The Translate user-message first line is exactly `Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.` Desktop and Computer Use each keep that string; Desktop must not import the experimental package. [Desktop selection Send to Agent](2026-09-17-desktop-selection-send-to-agent.md) owns the third toolbar button.

[Experimental Computer Use](2026-09-13-experimental-computer-use.md) still owns first-frame attach. After `agent/pre-step` `next()`, Computer Use skips `observeDesktop` when a claimed `source.kind === 'user'` message starts with that preamble. POLICY adds one paragraph: that turn is text-only in this chat; no GUI tools, no `code_agent`, no `screenshot`. Schemas stay registered. `SESSION_FORMAT_VERSION` is unchanged. There is no OCR path and no background `code_agent` for Translate.

[Desktop overlay-guard IPC](../architecture/2026-09-14-desktop-overlay-guard.md) exclude ids are visible overlay windows: the ball, and the toolbar only while shown. HID `input` hides the toolbar instead of a second click-through window. While the overlay Computer Use session is running, or during that HID interval, the toolbar stays hidden and reads are skipped so clipboard paste for `input_text` cannot race `Cmd+C`.

## Alternatives considered

**Cordis capability seam.** Search never enters the agent, and Translate only needs overlay `session/prompt`. A Service Definition / Provider / Consumer split would add package surface for one Electron host.

**Session-format field to skip the first frame.** That would bump `SESSION_FORMAT_VERSION` for a Desktop-only prompt. A model-visible preamble is reconstructable from the log and needs no new event type.

**Import `@deepseek-ai/dsh-experimental-tool-computer-use` from Desktop.** Release apps must not name that package. The preamble is duplicated and pinned in both test files.

**Load the helper as a dylib via koffi.** Same-process monitoring shares Electron's Accessibility identity, but asar, code signing, and Electron's native-module policy keep a compiled N-API addon, the same path as overlay-exclude capture. [Desktop selection toolbar in the Orb process](../architecture/2026-09-21-desktop-selection-in-process-identity.md) owns that packaging.

**CoView-style isolated translation or a background Code agent for Translate.** Translate must appear on the same Computer Use session the ball and the main-window `dsh_orb` row already show. A hidden translator or `code_agent` would split the transcript.

**Windows toolbar in this cut.** The ball is already Darwin-only. UI Automation plus an event hook is a later host.

## Consequences

The preamble is a compatibility string: changing it without both copies and the POLICY paragraph will attach a screenshot or let the model call GUI tools. Accessibility must be granted or the toolbar never appears. Clipboard fallback overwrites the string pasteboard for up to 150ms; overlay-guard HID and a running overlay session disable that path. Packaged apps must unpack `lib/macos-selection-napi.node` and `lib/libmacos-selection.dylib`; tests that import `src/` do not load the addon because that file is missing next to TypeScript sources.

## Testing

Desktop tests cover config read/write, Bing URL, prompt composition, helper NDJSON parse (including AX bounds plus mouse-up, and `dismiss`), in-process N-API start (threadsafe function, no activation-policy change, missing-addon skip), toolbar geometry below mouse-up including language-menu grow and flip, controller search/translate/send-to-agent/dedupe/pause, hide on `key`/`dismiss`/outside mouse-down and keep-visible on a click inside the bar, placement that ignores window-origin AX bounds, restoring the selection pid after Translate and skipping the Electron pid, overlay exclude ids for visible overlay windows, darwin toolbar construction, linux skip, overlay IPC `session/prompt` for Translate, attach IPC and overlay focus for Send to Agent, activate suppression for Translate, interact and setContentSize IPC, and locale-owned toolbar copy. Computer Use pre-step tests skip on the pinned preamble and still attach on a normal user turn; `tools.spec.ts` and `snapshots/session/computer-use/system-prompt.expected.md` pin the POLICY paragraph.
