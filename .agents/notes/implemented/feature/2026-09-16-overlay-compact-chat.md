# Agent Note: Overlay Compact ChatView

Status: implemented

English | [中文](2026-09-16-overlay-compact-chat.zh.md)

## Problem

The macOS floating ball expanded a 320×420 shell page whose transcript was a second bubble chat: dark user pills, assistant bubbles, a 1.5s `session/page` poll, and `scrollTop = scrollHeight` on every refresh. That transcript could not show Compact process rows (context injection, one-line think, tool rows, unbubbled markdown) or ChatView follow. Loading `dsh-app://app/index.html` as the overlay document would boot AppFrame and the mode picker the compact ball must not show.

## Decision

The overlay document stays [`apps/desktop/renderer/floating.html`](../../../../apps/desktop/renderer/floating.html). `#transcript` hosts an iframe of `dsh-app://app/index.html?surface=overlay` created on first expand and kept after collapse. [`ui-overlay-chat`](../../../../packages/client/ui-overlay-chat/README.md) occupies `'root'` only on that query, declares session-scoped `conversation.view`, and renders ChatView. [`ui-layout`](../../../../packages/client/ui-layout/README.md) skips AppFrame `'root'` and still provides `ctx.layout` plus a ThemePresenter that paints the light palette without writing Host settings. [`ui-chat`](../../../../packages/client/ui-chat/README.md) forces Compact. [`ui-user-questions`](../../../../packages/client/ui-user-questions/README.md) always `next()`s so vanilla [`floating.js`](../../../../apps/desktop/renderer/floating.js) remains the overlay `'user-questions/request'` claimer.

ClientSessions selection on the overlay document persists under `dsh.overlay.sessions.current`. The iframe shares the `dsh-app://app` origin with the main window; a shared `dsh.sessions.current` cell would steal the main-window selection. The shell posts `{ type: 'dsh.overlay.session', sessionId }` from `dsh-app://shell`; the iframe replies `{ type: 'dsh.overlay.ready' }` and calls `sessions.open` without reloading.

Vanilla chrome stays: 320×420 panel, 72px ball, grey input pill, History / New, Stop, Computer Use + Flash/Max, `floating-session.json`, and the ask-user card. History still hides `#transcript`. A question no longer hides the transcript. ChatView owns follow (`FOLLOW_THRESHOLD` 24px). Overlay CSS sets `--dsh-chat-content-width: 100%` and `--dsh-composer-side-clearance: 0px`, and hides `[data-chat-turn-rail]`.

See [Desktop floating orb](2026-09-14-desktop-floating-orb.md) for overlay construction and [floating orb user questions](2026-09-15-floating-orb-user-questions.md) for the shell waterfall.

## Alternatives considered

**Loading `index.html` as the overlay document.** That would reuse ChatView but boot the mode picker. The iframe is a nested Compact surface, not a second AppFrame window.

**A vanilla Compact port in `floating.js`.** That would reimplement ChatView, live chunks, markdown, and follow. The iframe reuses the shipped pipeline.

**Calling `theme.setTheme('light')`.** That writes Host settings and would flip the main window. ThemePresenter force-light is document-local.

**Letting the iframe claim `'user-questions/request'`.** That would add a third waterfall client beside the main window and `floating.js`. The iframe `next()`s; the shell card stays the overlay answerer.

## Consequences

The overlay iframe is a third Gateway Client for Session follow, not for questions. Opening an orb chat writes only `dsh.overlay.sessions.current`. `sidebarRight` stays in the roster so `ui-chat` inject is satisfied; `openFile` has no rightbar. `ui-conversation` never declares `conversation.view` on overlay because its inject into `main` waits on AppFrame.

Unpackaged Desktop prepares `.desktop-build/development/project` from the workspace virtual hoist. A web-app-only plugin such as `ui-overlay-chat` can be absent from that hoist; `prepareDevelopmentProject` then links remaining names from the nested `node_modules` of `@deepseek-ai/dsh-web-app` and `@deepseek-ai/dsh-base`. `start:desktop` (`--skip-build`) rebuilds `session-controller`, `ui-layout`, `ui-chat`, `ui-user-questions`, and `ui-overlay-chat` so the Host loader and overlay iframe client halves exist.

## Testing

Desktop renderer tests pin the iframe `src`, the absence of `.bubble.assistant`, Session postMessage, History hiding the iframe, a question leaving the iframe visible, and no `session/page` poll. `ui-overlay-chat` gui specs pin Compact root, content-width CSS, and `open(sessionId)`. `ui-layout` skips AppFrame root on overlay. `session-controller` persist name follows `?surface=overlay`. `ui-user-questions` always `next()`s on overlay. `ui-chat` forces Compact on overlay. Desktop `development-project` tests pin a web-app nested `@deepseek-ai/dsh-client-ui-overlay-chat` omitted from the hoist appearing in the generated project.
