# Agent Note: Desktop floating orb and dual Agent

Status: implemented

English | [中文](2026-09-14-desktop-floating-orb.zh.md)

## Problem

Computer Use is an experimental overlay that a Web `--patch` can mount, but Desktop packaged the Web UI as one main window with the `standard` default. A user who wants GUI control and background coding from the same desktop shell would otherwise get a second Web client, a mode picker on a compact overlay, or a `tool-subagent` child that the sidebar hides.

## Decision

macOS Desktop creates a second Electron overlay after Host ready: a 72px always-on-top panel that loads `dsh-app://shell/floating.html` through the existing shell preload. The page fetches the same Host `/api` as the main window. It does not boot `dsh-app://app/index.html`. Windows keeps today's single main window.

The overlay session calls `session.create({ agentPreset: 'computer-use', workspaceId })` after `workspace.create` on `$DSH_HOME/dsh_orb` (sidebar title `dsh_orb`) and selects `deepseek-v4-flash-vision-exp` when that route exists. The active overlay id is stored in the Desktop profile as `floating-session.json`. The main window keeps its current session; overlay sessions and `code_agent` rows whose cwd matches that workspace appear under `dsh_orb`. SessionHeader origin is unchanged.

The overlay is one 72px GIF ball that hover-expands a 320×420 white panel (300ms) while the ball stays in the input-pill corner. Click pins the panel; click again unpins, and the pointer leaving both then collapses after 180ms. Drag records the pointer offset against the ball, collapses immediately, and moves by ball origin so stored expand direction cannot slide the ball. Clamp runs on pointerup inside the work area; there is no edge dock. Enter sends; Stop shows only while the Computer Use session is running; a New control mints another Computer Use session on `dsh_orb`.

`code_agent` is registered only on the Computer Use preset. Create uses `session.create({ agentPreset: 'standard' })` with no `origin: 'subagent'` and no `parentAgent`. Prompt uses `mode: 'queue'` and returns `{ accepted: true }` without waiting for the turn. Omit `session_id` to mint a blank standard session; pass the previous result id to enqueue another user message on that session. The Computer Use policy tells the model to keep visible GUI on the five GUI tools, continue the same artifact with the prior id, and start unrelated work without an id.

Desktop Host overlay YAML inserts `computer-use-preset-root` from `../lib/computer-use-preset-root.js` and keeps `default: standard` with mode selection enabled. `prepare-dsh` copies `@deepseek-ai/dsh-experimental-tool-computer-use` into `extraResources/dsh` as a runtime extra and rewrites the preset composition to `lib/*.js`. Release apps still must not name the experimental package in `dependencies`. Both windows set `contentProtection` so Computer Use screenshots skip Electron chrome. The overlay stays on every Space and above fullscreen with `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })`. After creating the overlay, Desktop calls `app.setActivationPolicy('regular')` and `app.dock.show()` so the Dock icon remains. The application menu includes the standard Edit and Window menus. Overlay right-click adds cut/copy/paste when the target is editable.

The [Computer Use plugin decision](2026-09-13-experimental-computer-use.md) remains the owner of GUI tools, policy text, and the experimental consent gate.

## Alternatives considered

**A second packaged Web client in the overlay.** Loading `dsh-app://app/index.html` would boot the full client, including the mode picker the compact ball must not show. The shell page reuses Host RPC instead.

**Lock the Desktop profile default to `computer-use`.** That would force the main window onto Computer Use. Overlay create names the preset; the shipped default stays `standard`.

**`tool-subagent` for background coding.** Sidebar filters `origin: 'subagent'`, and `session.prompt` rejects those ids. Delegated work must be a first-class standard session.

**A new SessionHeader origin for the orb.** That would bump `SESSION_FORMAT_VERSION` for a Desktop-only grouping. Membership on the `dsh_orb` workspace is enough.

**Declare the experimental package as a Desktop Host dependency.** Experimental AGENTS.md forbids release apps from naming it. The runtime extra copy is the exception; the locator lives in Desktop Host.

**Windows overlay in this cut.** The ball is macOS `type: 'panel'` plus `setVisibleOnAllWorkspaces` with `skipTransformProcessType`. Windows stays one window.

## Consequences

Closing the main window on darwin leaves the ball running until an explicit Quit from the Dock, Cmd+Q, or the overlay context menu. The overlay has no voice, lasso, selection toolbar, or per-click approval. Chrome exclusion is Electron `contentProtection` only; ScreenCaptureKit window exclusion is absent. Restart resumes the stored Computer Use session when Host still holds it. Overlay Computer Use cwd is `$DSH_HOME/dsh_orb`. Snapshot and package tests pin `code_agent` routing examples (WeChat/Pages GUI, Word create, font-green continue, gobang new session) and the macOS-only overlay construction.

## Testing

Desktop copies the runtime extra and keeps overlay YAML on `default: standard`. Computer Use package tests cover `code_agent` create without subagent origin, create with `workspaceId` when caller cwd matches a workspace, continue by `session_id`, reject CU/subagent/cwd mismatch, and two `user/message` events on the continued session versus a new session when the id is omitted. The computer-use snapshot overlay stubs `sessionController` so the header pin includes the `code_agent` schema. Client tree tests still omit ids supplied as `hiddenSessionIds` and keep the delegated standard row. Electron tests create a `type: 'panel'` overlay on darwin, skip it off darwin, set `contentProtection` on both windows, pass `skipTransformProcessType: true`, and call `app.setActivationPolicy('regular')` plus `app.dock.show()` after overlay create. They also pin the application Edit menu, overlay editable-field paste items, expand bounds that keep the ball origin, expanded `moveFloatingBall` without panel clamp, and work-area clamp without edge snap. The overlay renderer creates the `dsh_orb` workspace, creates the Computer Use session over Host RPC, selects the vision model, sends on Enter, and drags with the ball grab offset after collapse.
