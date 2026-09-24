---
description: "Compact Chat root for the Desktop floating-ball overlay iframe; for maintainers of the macOS overlay transcript."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-overlay-chat

English | [中文](README.zh.md)

## Summary

This package occupies the browser `'root'` slot with Compact Chat when the document query is `?surface=overlay`. The Desktop floating ball keeps its own shell page and hosts this document in a transcript iframe, so thinking, tools, context injection, markdown, live streaming, and ChatView follow all come from the main-window Chat pipeline without mounting AppFrame or the mode picker.

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

Mount this plugin in the Web composition. On a main-window document it is a no-op. On `dsh-app://app/index.html?surface=overlay` it owns `'root'`, declares session-scoped `conversation.view` and `conversation.input.overlay`, and renders ChatView only. The floating-ball shell posts the orb Session id; this plugin calls `sessions.open` without reloading. There is no Config.

### Isolation

The iframe shares the `dsh-app://app` origin with the main window. ClientSessions selection persists under `dsh.overlay.sessions.current`, not `dsh.sessions.current`, so opening an orb chat cannot steal the main-window selection.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin returns immediately unless `overlayClientSurface()` is true. One effect registers `OverlayChatRoot` on `'root'` and declares `conversation.view` plus `conversation.input.overlay`; `ui-layout` skips AppFrame on this document, so there is no dual `'root'` occupant. `ui-conversation` waits to inject into `main.conversation` and never declares `conversation.view` here. The shell posts `{ type: 'dsh.overlay.session', sessionId }` from `dsh-app://shell`; the iframe replies `{ type: 'dsh.overlay.ready' }` and retries `sessions.open` until the Host list includes that id. Overlay CSS sets `--dsh-chat-content-width: 100%`, `--dsh-composer-side-clearance: 0px`, hides `[data-chat-turn-rail]`, and paints `--dsw-alias-bg-base`. `ui-chat` forces Compact. `ui-user-questions` always `next()`s so vanilla `floating.js` remains the overlay waterfall claimer. The iframe sets `allow="clipboard-write"`; [overlay message actions](../../../.agents/notes/implemented/bug-fix/2026-09-17-overlay-message-actions-narrow.md) owns that permission, the IconActions clock ellipsis, and the zero-size input-overlay host. The [overlay Compact ChatView Agent Note](../../../.agents/notes/implemented/feature/2026-09-16-overlay-compact-chat.md) owns the Compact root decision. [Overlay Appearance](../../../.agents/notes/implemented/feature/2026-09-18-overlay-appearance-follows-host.md) owns following Host without writing settings.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Desktop floating orb](../../../.agents/notes/implemented/feature/2026-09-14-desktop-floating-orb.md) — overlay construction and Computer Use session.
- [ui-chat](../ui-chat/README.md) — Compact ChatView this root renders.
- [ui-layout](../ui-layout/README.md) — AppFrame skip and overlay ThemePresenter.
- [Desktop user guide](../../../docs/user/guide/desktop.md) — product-facing overlay chrome.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders an already-logged Session for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the overlay Compact root. They are current package constraints, not a Desktop overlay backlog.

- **No composer, hero, or sidebar** — the floating-ball shell owns History, New, the input pill, Stop, and the ask-user card. This package does not declare `conversation.composer`. It does host `conversation.input.overlay` as a zero-size seat so FeedbackDialog can portal.
- **Ask-user stays on the shell** — the iframe `next()`s `'user-questions/request'` so a closed main window still has one overlay answerer in `floating.js`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package occupies `'root'` only on the overlay document and proves disposal through the HMR-safety spec.
