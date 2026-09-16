# Agent Note: Desktop selection toolbar

Status: implemented

English | [中文](2026-09-16-desktop-selection-toolbar.zh.md)

## Problem

macOS users select text in other apps and expect Search, Translate, and Agent Explain without opening a new session or attaching a screenshot. The floating ball had no selection toolbar. A Cordis capability seam, a session-format field, or importing the experimental Computer Use package from the Electron app would either widen the product API or violate the release-app naming rule.

## Decision

macOS Desktop owns the feature in the Electron shell. A spawned Darwin helper (`apps/desktop/src/macos-selection.swift`, compiled to `lib/macos-selection`) watches left-button drags longer than 8px, then reads `AXSelectedText` (and selection bounds) or falls back to clipboard `Cmd+C` with backup and restore. It ignores the Electron PID. Selection payloads always include the mouse-up point. The toolbar sits 8px below that point, not the AX rectangle: browsers often report window-local or chrome-origin `kAXBoundsForRangeParameterizedAttribute` rects that would pin the bar at the window top-left. A 3s `pid + bundle + text` dedupe, outside mouse-down, Escape, and a new drag hide the toolbar. Accessibility off emits `untrusted` and does not tap; the first untrusted event opens System Settings via `systemPreferences.isTrustedAccessibilityClient(true)`. Windows does not start the monitor.

The helper is a signed child inside the app bundle (`asarUnpack: lib/macos-selection`), not a `dlopen` dylib. Electron packaging and TCC identity for Accessibility/clipboard posting are simpler when the helper is a normal executable next to the unpacked main script.

A third `type: 'panel'` window loads `dsh-app://shell/selection-toolbar.html` without activating Desktop. Copy is locale-owned. Preferences persist as `selection-toolbar.json` next to `floating-session.json` (`enabled: true`, `translateTargetLanguage: 'zh'` by default). Overlay right-click toggles enablement.

Search opens `https://www.bing.com/search?q=` plus the encoded selection in the default browser and does not prompt the agent. Translate and Explain hide the toolbar, expand the ball, and `session/prompt` `mode: 'queue'` the current overlay Computer Use session. They must not show or focus the main window, and must not keep Desktop as the frontmost app: toolbar IPC ignores `app` `activate` for 2s, the overlay expands with `showInactive`, the toolbar hides after that send, a focused main window `blur()`s, and the Darwin helper stdin `activate-pid` re-activates the selection's process (Electron and helper pids are skipped). Search leaves focus with the browser. Dock `activate` after that interval still shows the main window. Opening the language menu resizes the toolbar panel around the compact bar origin (down, or up when the work area would clip it) and closing it restores the compact size so transparent chrome does not eat clicks. The user-message first line is exactly `Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.` Desktop and Computer Use each keep that string; Desktop must not import the experimental package.

[Experimental Computer Use](2026-09-13-experimental-computer-use.md) still owns first-frame attach. After `agent/pre-step` `next()`, Computer Use skips `observeDesktop` when a claimed `source.kind === 'user'` message starts with that preamble. POLICY adds one paragraph: that turn is text-only in this chat; no GUI tools, no `code_agent`, no `screenshot`. Schemas stay registered. `SESSION_FORMAT_VERSION` is unchanged. There is no OCR path and no background `code_agent` for Explain.

[Desktop overlay-guard IPC](../architecture/2026-09-14-desktop-overlay-guard.md) exclude ids are visible overlay windows: the ball, and the toolbar only while shown. HID `input` hides the toolbar instead of a second click-through window. While the overlay Computer Use session is running, or during that HID interval, the toolbar stays hidden and reads are skipped so clipboard paste for `input_text` cannot race `Cmd+C`.

## Alternatives considered

**Cordis capability seam.** Search never enters the agent, and translate/explain only need overlay `session/prompt`. A Service Definition / Provider / Consumer split would add package surface for one Electron host.

**Session-format field to skip the first frame.** That would bump `SESSION_FORMAT_VERSION` for a Desktop-only prompt. A model-visible preamble is reconstructable from the log and needs no new event type.

**Import `@deepseek-ai/dsh-experimental-tool-computer-use` from Desktop.** Release apps must not name that package. The preamble is duplicated and pinned in both test files.

**Load the helper as a dylib via koffi.** Same-process CGEventTap would share Electron's Accessibility identity, but asar, code signing, and Electron's native-module policy make a spawned signed executable the packaging path that already exists for `macos-sck-capture`.

**CoView-style isolated translation or a background Code agent for Explain.** Translate and Explain must appear on the same Computer Use session the ball and the main-window `dsh_orb` row already show. A hidden translator or `code_agent` would split the transcript.

**Windows toolbar in this cut.** The ball is already Darwin-only. UI Automation plus an event hook is a later host.

## Consequences

The preamble is a compatibility string: changing it without both copies and the POLICY paragraph will attach a screenshot or let the model call GUI tools. Accessibility must be granted or the toolbar never appears. Clipboard fallback overwrites the string pasteboard for up to 150ms; overlay-guard HID and a running overlay session disable that path. Packaged apps must unpack `lib/macos-selection`; tests that import `src/main.ts` do not spawn the helper because that path is missing next to TypeScript sources.

## Testing

Desktop tests cover config read/write, Bing URL, prompt composition, helper NDJSON parse (including AX bounds plus mouse-up), toolbar geometry below mouse-up including language-menu grow and flip, controller search/translate/explain/dedupe/pause, placement that ignores window-origin AX bounds, restoring the selection pid after translate/explain and skipping the Electron pid, overlay exclude ids for visible overlay windows, darwin toolbar construction, linux skip, overlay IPC `session/prompt`, activate suppression for translate/explain, interact and setContentSize IPC, and locale-owned toolbar copy. Computer Use pre-step tests skip on the pinned preamble and still attach on a normal user turn; `tools.spec.ts` and `snapshots/session/computer-use/system-prompt.expected.md` pin the POLICY paragraph.
