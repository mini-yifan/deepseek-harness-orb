# Agent Note: Desktop floating orb and dual Agent

Status: implemented

English | [中文](2026-09-14-desktop-floating-orb.zh.md)

## Problem

Computer Use is an experimental overlay that a Web `--patch` can mount, but Desktop packaged the Web UI as one main window with the `standard` default. A user who wants GUI control and background coding from the same desktop shell would otherwise get a second Web client, a mode picker on a compact overlay, or a `tool-subagent` child that the sidebar hides.

## Decision

macOS Desktop creates a second Electron overlay after Host ready: a 72px always-on-top panel that loads `dsh-app://shell/floating.html` through the existing shell preload. The page fetches the same Host `/api` as the main window. It does not boot `dsh-app://app/index.html`. Windows keeps today's single main window.

The overlay session calls `session.create({ agentPreset: 'computer-use', workspaceId })` after `workspace.create` on `$DSH_HOME/dsh_orb` (sidebar title `dsh_orb`) and selects `deepseek-flash` with reasoning effort `max` on every overlay open. The active overlay id is stored in the Desktop profile as `floating-session.json`. The main window keeps its current session; overlay sessions and `code_agent` rows whose cwd matches that workspace appear under `dsh_orb`. SessionHeader origin is unchanged.

The overlay is one 72px GIF ball that hover-expands a 320×420 white panel (300ms) while the ball stays in the input-pill corner. Click pins the panel; click again unpins, and the pointer leaving both then collapses after 180ms. Unpinning while the pointer remains on the overlay leaves the panel expanded. During collapse the ball stays in its expand corner until the window shrinks to 72px. Drag records the pointer offset against the ball, collapses immediately, and moves by ball origin so stored expand direction cannot slide the ball. Clamp runs on pointerup inside the work area; there is no edge dock. Enter sends; Stop is a body sibling (`#ball` z-index 1, `#stop` z-index 2) at the opposite end of the input pill from the ball and shows only while the Computer Use session is running, replacing the hidden input; a click calls `session/cancel` for that overlay session. A History control replaces the transcript with Computer Use sessions whose cwd is `dsh_orb` and whose projected preset is `computer-use`; delegated standard and `code_agent` rows stay out of that list. A click adopts that id into `floating-session.json` and restores the transcript so further prompts continue that chat. A New control mints another Computer Use session on `dsh_orb`. When that Computer Use session raises `ask_user_question`, the overlay claims the live `'user-questions/request'` waterfall and renders a compact answer card in the expanded panel; [floating orb user questions](2026-09-15-floating-orb-user-questions.md) owns that Client path.

`code_agent` is registered only on the Computer Use preset. Create uses `session.create({ agentPreset: 'standard' })` with no `origin: 'subagent'` and no `parentAgent`. Prompt uses `mode: 'queue'` and returns `{ accepted: true }` without waiting for the turn. A Computer Use-owned watch later parks a plugin notice until both sessions are idle; [Computer Use parks Code agent completion](2026-09-15-computer-use-code-agent-completion.md) owns that delivery. Omit `session_id` to mint a blank standard session; pass the previous result id to enqueue another user message on that session. The Computer Use policy tells the model to keep visible GUI on the five GUI tools, continue the same artifact with the prior id, start unrelated work without an id, tell the user the background agent is running and end the turn, and report a later plugin notice.

Desktop Host overlay YAML inserts `computer-use-preset-root` from `../lib/computer-use-preset-root.js` and `computer-use-overlay-guard` from `../lib/computer-use-overlay-guard.js`, and keeps `default: standard` with mode selection enabled. `prepare-dsh` copies `@deepseek-ai/dsh-experimental-tool-computer-use` into `extraResources/dsh` as a runtime extra and rewrites the preset composition to `lib/*.js`. Release apps still must not name the experimental package in `dependencies`. The main window stays capturable. The overlay is capture-excluded through ScreenCaptureKit `excludingWindows` and click-through only for the matching Computer Use interval; see [Desktop overlay guard](../architecture/2026-09-14-desktop-overlay-guard.md). The overlay stays on every Space and above fullscreen with `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })`. After creating the overlay, Desktop calls `app.setActivationPolicy('regular')` and `app.dock.show()` so the Dock icon remains. The application menu includes the standard Edit and Window menus. Overlay right-click adds cut/copy/paste when the target is editable.

The [Computer Use plugin decision](2026-09-13-experimental-computer-use.md) remains the owner of GUI tools, policy text, and the experimental consent gate.

## Alternatives considered

**A second packaged Web client in the overlay.** Loading `dsh-app://app/index.html` would boot the full client, including the mode picker the compact ball must not show. The shell page reuses Host RPC instead.

**Lock the Desktop profile default to `computer-use`.** That would force the main window onto Computer Use. Overlay create names the preset; the shipped default stays `standard`.

**`tool-subagent` for background coding.** Sidebar filters `origin: 'subagent'`, and `session.prompt` rejects those ids. Delegated work must be a first-class standard session.

**A new SessionHeader origin for the orb.** That would bump `SESSION_FORMAT_VERSION` for a Desktop-only grouping. Membership on the `dsh_orb` workspace is enough.

**Declare the experimental package as a Desktop Host dependency.** Experimental AGENTS.md forbids release apps from naming it. The runtime extra copy is the exception; the locator lives in Desktop Host.

**Windows overlay in this cut.** The ball is macOS `type: 'panel'` plus `setVisibleOnAllWorkspaces` with `skipTransformProcessType`. Windows stays one window.

**Place Stop on the ball.** That covers the GIF and shares the drag/pin corner. Stop sits in the opposite 72px cap of the pill, 14px inset, as a body sibling so it paints above the pill.

## Consequences

Closing the main window on darwin leaves the ball running until an explicit Quit from the Dock, Cmd+Q, or the overlay context menu. The overlay has no voice, lasso, selection toolbar, or per-click approval. The overlay is a second Gateway Client for live `'user-questions/request'` waterfalls on Computer Use sessions it holds, so a closed main window still has an answerer. Overlay capture exclusion and click-through are scoped to Computer Use intervals; capture omit uses ScreenCaptureKit window ids for the whole overlay window. Restart resumes the stored Computer Use session when Host still holds it. Overlay Computer Use cwd is `$DSH_HOME/dsh_orb`. Snapshot and package tests pin `code_agent` routing examples (WeChat/Pages GUI, Word create, font-green continue, gobang new session) and the macOS-only overlay construction.

## Testing

Desktop copies the runtime extra and keeps overlay YAML on `default: standard`. Computer Use package tests cover `code_agent` create without subagent origin, create with `workspaceId` when caller cwd matches a workspace, continue by `session_id`, reject CU/subagent/cwd mismatch, two `user/message` events on the continued session versus a new session when the id is omitted, and parked completion notices that wait for both sessions to go idle. The computer-use snapshot overlay stubs `sessionController` so the header pin includes the `code_agent` schema. Client tree tests still omit ids supplied as `hiddenSessionIds` and keep the delegated standard row. Electron tests create a `type: 'panel'` overlay on darwin, skip it off darwin, leave both windows capturable by default, pass `skipTransformProcessType: true`, and call `app.setActivationPolicy('regular')` plus `app.dock.show()` after overlay create. They also pin the application Edit menu, overlay editable-field paste items, expand bounds that keep the ball origin, expanded `moveFloatingBall` without panel clamp, and work-area clamp without edge snap. The overlay renderer creates the `dsh_orb` workspace, creates the Computer Use session over Host RPC, selects DeepSeek-V41-Flash at Max thinking, sends on Enter, places Stop at the opposite pill end from the ball, shows Stop after a prompt and calls `session/cancel` on click, drags with the ball grab offset after collapse, keeps the panel expanded when unpinning while the pointer is still on the ball, lists only `dsh_orb` Computer Use chats from History (omitting delegated standard rows), adopts a selected id for further prompts, and claims live `'user-questions/request'` waterfalls for those sessions so the compact card can answer or `next()`.
