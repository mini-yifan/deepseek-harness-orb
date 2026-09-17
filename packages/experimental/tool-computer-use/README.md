---
description: "Opt-in experimental GUI tools that let a vision model click, type, scroll, drag, long-press, list and open apps, open files and the browser, and hotkey the host desktop, with the frontmost window attached on the first user turn and after every action."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-computer-use

English | [中文](README.zh.md)

## Summary

Give a vision-capable agent live sight of the host's frontmost application window and thirteen exclusive GUI tools so it can click, type, scroll, drag, long-press, list and open apps, open files and the browser, press hotkeys, wait, and save a screenshot to Desktop and the clipboard, then see the new window in the same tool result. Mount it only when you want that unsandboxed control. Text-only routes skip the first screenshot and refuse the tools. macOS is the production backend; other hosts load the plugin and fail at execute.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Patch this private overlay onto a running Web composition when you want a dedicated Computer Use agent that operates the real desktop. The overlay adds a system agent preset; GUI tools register in that preset's scope, not on the Host. Installing or patching is the consent gate: the tools never ask per click.

### When to choose it

Choose it when a vision model should drive visible GUI chrome that bash cannot reach, and you want a catalog limited to Shell, web search and fetch, the thirteen GUI tools, `code_agent`, and `ask_user_question`. Avoid it for ordinary coding sessions, text-only routes, and any host that must not grant Screen Recording, Accessibility, and Automation for Finder. It is not a Skill, not a capability seam, and not part of `dsh-base`. Desktop macOS also mounts this overlay as a signed runtime extra so the floating ball can lock a Computer Use session.

### Minimal configuration

`pnpm dsh` already runs through tsx, so patch the source overlay and restart the running `dsh web`. The locator plugin's relative entry is anchored to the patch file, matching the Inspector try path, so the CLI app does not depend on this experimental package:

```text
pnpm dsh web --patch packages/experimental/tool-computer-use/cordis.source.patch.yml
```

Create a new session and choose Computer Use in the mode picker. Existing sessions keep their preset. The deployment default remains `standard`, which does not receive the GUI tools.

After `pnpm run build`, [`cordis.patch.yml`](cordis.patch.yml) loads the emitted `./lib/preset-root.js` locator the same way.

A custom Loader composition that can resolve the package name may instead mount:

```yaml
- id: tool-computer-use
  name: '@deepseek-ai/dsh-experimental-tool-computer-use'
  config:
    postActionWaitMs: 600
```

| Field | Default | Meaning |
|---|---|---|
| `postActionWaitMs` | `600` | Milliseconds to wait after a GUI action before inspect and pixel capture |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-tool-computer-use) is the exhaustive source for every accepted field and its JSDoc.

On macOS, grant Screen Recording to capture, Accessibility to post clicks and keys, and Automation for Finder. Missing Screen Recording or Accessibility fails the capture or input with a message that names that TCC right. Windows and Linux still load; every backend method then throws `computer-use: desktop control is implemented only on macOS`.

### The tools

There is no `observe` tool. The first user turn already includes the current frontmost window, and every GUI tool returns the post-action window as native image blocks in the tool result. `screenshot` is an export: it writes that raster to the user Desktop and copies it to the clipboard. The image includes that app's open menus, popovers, and panels. It does not include the Dock, menu bar, other applications (except where they overlap this app's windows), or other displays.

| Tool | Arguments | After the action |
|---|---|---|
| `click` | `screen_index` (0), `position: [x,y]` (0–1000), optional `button` (`left`/`right`), optional `count` (1 or 2) | click, wait, recapture |
| `input_text` | `screen_index`, `position`, `text`, optional `replace`, optional `submit` | click-focus, type, optional Enter, wait, recapture |
| `scroll` | `screen_index`, `position`, `direction` (`up`/`down`), `scroll_level` 1–10 | scroll, wait, recapture |
| `hotkey` | `keys: string[]` | key combo; system screenshot chords are rejected; wait, recapture |
| `wait` | none | pause 1s, recapture |
| `long_wait` | required `wait_seconds`: 10, 30, 60, or 120 | pause, recapture |
| `screenshot` | none | save Desktop files, copy the window to clipboard, return that window |
| `long_press` | `screen_index`, `position`, optional `duration_seconds` 1–10 (default 3) | left-button hold, wait, recapture |
| `drag` | `start_screen_index`, `start_position`, `end_screen_index`, `end_position` | drag on the attached window, wait, recapture |
| `open_in_browser` | optional `url` (http(s); omit launches the default browser) | `/usr/bin/open`, wait, recapture |
| `open_in_finder` | optional `path` (omit = Desktop), optional `reveal_only` | Finder or default app, wait, recapture |
| `list_apps` | none | list running regular apps, recapture |
| `open_app` | `name` (display name or bundle id) | activate or launch, wait, recapture |
| `code_agent` | `task`, optional `session_id`, optional `cwd` | enqueue on a first-class standard session and return that `session_id`; a plugin notice follows after both sessions are idle |

The thirteen GUI tools run exclusive. `presentCall` is generic. Each observation starts with `<frontmost_app>` (plus `<frontmost_window>` when the window has a title, `<frontmost_folder>` when Finder or 访达 is frontmost, or `<focus_note>` when no remaining window remains after skipping the overlay). The optional screen envelope then names index 0 and the 0–1000 space of that window. They never include pixel sizes, downscale multipliers, or a screenshot filesystem path. When no operable window remains, the observation is those tags only — there is no desktop panorama.

Tests inject a fake desktop through `applyComputerUse(ctx, backend, config)` rather than a Config `driver` hook.

On Desktop, omitting `session_id` applies the floating-ball Background Agent Settings when the Host publishes that selection. Passing `session_id` leaves the continued session's model unchanged. Other compositions keep the deployment Agent default.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the plugin and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The plugin is one experimental package on purpose. The existing agent-loop already turns a tool result that contains images into the next model request, so Computer Use does not add an observe tool and does not change loop semantics. Grounding copy is a `systemPrompt.section`, not a Skill. A second backend would justify splitting Service Definition from Provider; this cut keeps macOS capture/input in the same package as the tools.

First-frame attachment uses `agent/pre-step`: the listener always awaits `next()`, then appends a plugin `user` notice with `form: 'notice'` when the claimed batch contains a `source.kind === 'user'` message and the route declares image input, except when that user text starts with `Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.` `agent.inject()` would land only on the next step.

Desktop `code_agent` create reads optional `ctx.get('orbCodeAgentModel')` after `session.create` and before `session.prompt`, passing `saveAsDefault: false`. Continue-by-`session_id` does not. This package does not import Desktop Host.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name` / `inject` / `Config` / `apply` over the host-platform backend |
| [`src/preset-root.ts`](src/preset-root.ts) | Overlay-only plugin: publishes the extra agent-presets root |
| [`src/plugin.ts`](src/plugin.ts) | Shared `applyComputerUse`: policy, thirteen GUI tools, first-frame pre-step |
| [`src/selection-turn.ts`](src/selection-turn.ts) | Detect Desktop selection-toolbar user turns so first-frame capture is omitted |
| [`src/observe.ts`](src/observe.ts) | Frontmost-window capture, overlay-skip foreground inspect, and model-facing envelopes |
| [`src/code-agent.ts`](src/code-agent.ts) | Computer Use-only `code_agent`: `session.create`, optional Desktop `selectModel` on create, `session.prompt` |
| [`src/code-agent-completion.ts`](src/code-agent-completion.ts) | Parked plugin notice after the Code session and the Computer Use caller are idle |
| [`src/macos.ts`](src/macos.ts) | Darwin capture via a full `screencapture` plus `sips` crop of the frontmost-app window union, or ScreenCaptureKit helper `--region=` when overlay window ids are set; click, scroll, hotkey, long-press, and drag via JXA `CGEvent`; `input_text` pastes via NSPasteboard; `list_apps` / `open_app` via NSWorkspace; `open_in_browser` / `open_in_finder` via `/usr/bin/open`; `inspectForeground` binds `CGWindowListCopyWindowInfo` then unwraps (skip overlay ids) plus Finder AppleScript |
| [`src/macos-sck-capture.swift`](src/macos-sck-capture.swift) | Darwin helper: window capture or display-exclude region crop that still omits overlay CGWindowIDs; starts `NSApplication` on the main actor first |
| [`src/open.ts`](src/open.ts) | `long_press` duration, `open_in_browser` URL, and `open_in_finder` path validation |
| [`src/wait-args.ts`](src/wait-args.ts) | Fixed 1s `wait` and `long_wait` 10/30/60/120 buckets |
| [`src/screenshot.ts`](src/screenshot.ts) | Desktop filenames and unique-path write for `screenshot` |
| [`src/overlay-guard.ts`](src/overlay-guard.ts) | Optional Desktop overlay cloak: `wrapDesktopBackend` around listScreens, capture, inspect, HID, `open_app`, and `withGuiTurn`; `list_apps` / `open_in_browser` / `open_in_finder` / `copyImageToClipboard` stay unwrapped |
| [`presets/computer-use/`](presets/computer-use/) | Computer Use agent preset: Shell, web, GUI tools, `code_agent`, `ask_user_question`, compaction |
| — | No runtime invariant companion is published because this plugin introduces no new session events; observations ride existing `user/message` and `tool/result`. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Experimental group](../README.md) — private prototypes and the public Agent Teams exceptions.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-computer-use) — the thirteen GUI schemas and `code_agent`.
- [Adding a tool](../../../docs/cookbook/adding-a-tool.md) — UI render intent (`generic`) and image blocks in content.
- [Computer Use Agent Note](../../../.agents/notes/implemented/feature/2026-09-13-experimental-computer-use.md) — plugin vs Skill vs loop, the Computer Use agent preset, observation-in-result, and the consent gate.
- [Computer Use pointer and open tools](../../../.agents/notes/implemented/feature/2026-09-15-computer-use-pointer-and-open-tools.md) — `long_press`, `drag`, `open_in_browser`, `open_in_finder`, overlay-guard split, and path/URL rejects.
- [Computer Use wait and long_wait](../../../.agents/notes/implemented/feature/2026-09-15-computer-use-wait-and-long-wait.md) — fixed 1s `wait`, `long_wait` buckets, and why the 10s floor is not Config.
- [Computer Use screenshot export](../../../.agents/notes/implemented/feature/2026-09-15-computer-use-screenshot.md) — Desktop file plus clipboard, not an observe tool.
- [Computer Use parks Code agent completion](../../../.agents/notes/implemented/feature/2026-09-15-computer-use-code-agent-completion.md) — parked plugin notice after both sessions are idle.
- [Computer Use observation foreground](../../../.agents/notes/implemented/feature/2026-09-15-computer-use-observation-foreground.md) — overlay-window skip, Finder folder, and focus fallback on existing `user/message` / `tool/result`.
- [Computer Use focused-window observation](../../../.agents/notes/implemented/feature/2026-09-16-computer-use-focused-window-observation.md) — one overlay-skipped frontmost window, `list_apps` / `open_app`, and no desktop panorama.
- [Computer Use app-window observation](../../../.agents/notes/implemented/feature/2026-09-16-computer-use-app-window-observation.md) — frontmost-app family window union and always-region capture.
- [Computer Use transient window observation](../../../.agents/notes/implemented/feature/2026-09-16-computer-use-transient-window-observation.md) — region helper for that union rectangle.
- [Computer Use context-menu observation](../../../.agents/notes/implemented/bug-fix/2026-09-16-computer-use-context-menu-observation.md) — settle-before-inspect and overlay input cloak through recapture.
- [Computer Use 0–1000 fraction coordinates](../../../.agents/notes/implemented/bug-fix/2026-09-15-computer-use-fraction-coordinates.md) — model-facing 0–1000 is a fraction of the visible screenshot, not capture pixels.
- [Image handle omits request-preview pixels](../../../.agents/notes/implemented/bug-fix/2026-09-15-omit-request-preview-handle-dimensions.md) — the shared image handle names identity, not request-preview width and height.
- [Desktop floating orb](../../../.agents/notes/implemented/feature/2026-09-14-desktop-floating-orb.md) — macOS overlay, runtime extra, and first-class `code_agent` sessions.
- [Floating-ball Agent model menus](../../../.agents/notes/implemented/feature/2026-09-17-orb-agent-model-menus.md) — overlay and background model persistence, `saveAsDefault: false`, create-only `code_agent` apply.
- [Desktop overlay guard](../../../.agents/notes/implemented/architecture/2026-09-14-desktop-overlay-guard.md) — capture exclusion and HID click-through for the floating ball.
- [Headless computer-use snapshot](../../../snapshots/session/computer-use/snapshot.yml) — authored click loop over a fake desktop and a vision model.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

One stable `tool:computer-use` section is assembled on every request while the plugin is mounted. The text below is the exact policy.

##### Computer Use policy

```markdown
Computer Use lets you see the current frontmost application window and operate the GUI.

See: trust only the attached screenshot of the frontmost application on this display for windows, buttons, and on-screen text. The image includes that app's open menus, popovers, and panels. It does not include the Dock, menu bar, other applications (except where they overlap this app's windows), or other displays. Do not assume UI that is not visible in the latest image. You may use observation tags <frontmost_app>, <frontmost_window>, <frontmost_folder>, and <focus_note> as OS metadata.

Coordinates: the attached screenshot uses a 0–1000 space of that window. [0, 0] is the top-left of that image and [1000, 1000] is the bottom-right. x and y scale independently; do not treat the space as a square overlay. Pass position as [x, y] in that space together with screen_index 0. Map the target as a fraction of the screenshot you see. Ignore pixel widths and any other image-handle dimensions. Do not send raw pixel coordinates.

Step: take exactly one GUI action per tool call. After the call, the new screenshot is in the tool result; use that image for the next action.

Do not click or type into a target you cannot see. Do not OCR file paths from the screenshot. When a file or folder path is known, call open_in_finder with that path; do not click Desktop icons to open it. When <frontmost_folder> is present, copy that path; otherwise use bash with real paths. When <focus_note> is present, call open_app to bring the target application forward if the next step needs a window. Do not click chrome that is not in the image.

If <frontmost_app> or the screenshot is not the application the user asked for, call list_apps or open_app. Do not click the Dock; it is not in the screenshot.

Observation is not a tool. Do not call screenshot merely to see the window — the first user turn and every GUI result already attach the frontmost window. Call screenshot when the user asked for a screenshot file or needs the image on the clipboard to paste.

This session drives the real unsandboxed desktop. Use bash only for short commands inside a GUI loop. Do not use bash to write long reports or a whole project — send that work to code_agent. Do not use bash open as a substitute for open_in_finder, open_in_browser, or open_app.

Open a site in the user's visible browser with open_in_browser. web_search and web_fetch return text to you; they do not open a window the user can see.

Drag sliders, window edges, and files with drag. Press and hold with long_press.

When the latest screenshot still shows a loader, spinner, or a control that has not appeared, call wait. After click or open, the tool result already has a new screenshot; do not immediately wait unless that image still shows loading. When the screenshot shows a long job still running (download, install, export, or in-window generation), call long_wait with the smallest of 10, 30, 60, or 120 that covers remaining progress. Do not use long_wait for ordinary page load.

Route the user's request yourself:
- Visible GUI such as opening WeChat or clicking a button in Pages → GUI tools only. Do not call code_agent.
- New background work such as writing a Word document → code_agent without session_id.
- Follow-up on the same artifact such as making that Word document's font green → code_agent with the session_id from that earlier result.
- Unrelated new background work such as making a gobang game after the Word document → code_agent without session_id. Do not reuse the Word session.

After code_agent returns, tell the user the background Code agent is running, then end the turn. Do not call wait, long_wait, or bash sleep to poll that session.

When a plugin notice reports that a Code agent session finished, tell the user which background task completed and what it produced.

When a user message starts with "Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.", answer in this chat only. Do not call GUI tools, code_agent, or screenshot on that turn.
```

#### Token effect

Fixed policy cost on every request while the plugin is mounted. First-frame screens and each GUI tool result add image tokens that remain until compaction.

#### KV Cache effect

Prefix-stable while the policy text and tool schemas remain unchanged. First-frame notices and tool-result images append after the reusable request prefix. Plugin HMR replaces the section and schemas.

### Tool schemas

#### What the model sees

The model sees the generated [`click`, `input_text`, `scroll`, `hotkey`, `wait`, `long_wait`, `screenshot`, `long_press`, `drag`, `open_in_browser`, `open_in_finder`, `list_apps`, `open_app`, and `code_agent` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-tool-computer-use). There is no observe tool. Text-only routes still receive the GUI schemas and are refused at execute. `code_agent` is registered only in the Computer Use preset.

#### Token effect

Fixed schema cost on every request in that tool view.

#### KV Cache effect

Prefix-stable while the fourteen definitions and order are unchanged. Registration lifecycle may invalidate reuse from the first changed schema token.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints. The plugin drives the real unsandboxed desktop.

- **macOS only** — capture and HID input are implemented on Darwin; other platforms throw at execute.
- **Screen Recording, Accessibility, and Automation TCC** — capture needs Screen Recording; clicks, typing, scroll, hotkeys, long-press, and drag need Accessibility; Finder folder lookup needs Automation for Finder. The plugin does not prompt for those rights.
- **No per-click approval** — installing or patching the plugin is the consent gate; a visual loop cannot ask on every action.
- **Host chrome is omitted from the shot when it is not the frontmost window** — Web windows appear only when that window is frontmost. Desktop's main window stays capturable when it is next after overlay skip. The macOS overlay is omitted from Computer Use screenshots by ScreenCaptureKit exclude-id checks (display exclude plus crop) and is click-through for HID bursts, `open_app`, and their recapture via ack'd overlay-guard IPC. Foreground inspect and `listScreens` skip those overlay window ids, so the main window can appear as `<frontmost_app>`.
- **Typing uses the string clipboard** — `input_text` pastes with Cmd+V and restores the previous string clipboard afterwards. Other clipboard types are not restored. `screenshot` replaces the pasteboard with the captured image and does not restore the previous clipboard.
- **Retina vs attached size** — backing scale and request rasters can differ from the capture; pass 0–1000 fractions of the visible screenshot.
- **Fixed settle wait** — post-action delay is `postActionWaitMs` before inspect and capture pixels; there is no pixel-diff stall.
- **No lasso or `manage_files`** — GUI coverage is click, type, scroll, hotkey, wait, long_wait, screenshot, long-press, drag, open-in-browser, open-in-finder, list-apps, and open-app. Switch apps with `open_app`; do not click the Dock. Background documents and code go through `code_agent`.
- **`code_agent` notice needs live Agents** — execute still returns after queue accept. A missing live Code agent, a disposed Computer Use caller, or a Code session that never returns to idle drops the notice. Policy cannot stop a model that still calls `wait` or `long_wait`.
- **Desktop overlay is macOS-only** — Windows Desktop keeps a single main window. The experimental package is a signed runtime extra, not a Desktop Host npm dependency.
- **Experimental prototype with no stability promise** — the package is private; schemas and backends can change freely.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
