# Agent Note: Floating-ball and background Agent model menus

Status: implemented

English | [中文](2026-09-17-orb-agent-model-menus.zh.md)

## Problem

The macOS floating ball always selected DeepSeek-V41-Flash at Max on overlay create, History adopt, and New, and `session/selectModel` also wrote `agent-default-model`. Background `code_agent` sessions then inherited that global New Chat default. Users need independent overlay and background routes from the ball without changing the main-window composer default.

## Decision

The overlay native context menu, rebuilt on every right-click from live `session/modelCatalog`, adds Floating Agent Settings and Background Agent Settings after Open Main. Each submenu groups by catalog `groups[]` (`group.name` as a disabled header, persist `group.id`). A model with `reasoning.efforts` nests consecutive `radio` items using `effort.name`; a model with no reasoning is a leaf `checkbox`. Never attach `submenu: []`. Effective effort is `current.reasoningEffort ?? defaultEffort`. A Default radio is added only when efforts exist and `defaultEffort` is absent. Overlay lists every catalog model. Checkmarks are independent between the two agents. Clicking an effort selects that provider + model + reasoningEffort.

Selections persist as Desktop profile `orb-agent-models.json` (`{ overlay, background }`), not inside `floating-session.json`. Absent or invalid JSON uses `{ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }` for both.

`SessionSelectModelRequest.saveAsDefault` defaults to true for composer `/model`. Overlay and `code_agent` pass `false` so they do not write `agent-default-model`. Overlay create, History adopt, and New apply the stored overlay selection. A live menu click persists then `webContents.send`s so the renderer `selectModel`s the current overlay session immediately.

Background apply is create-only. Electron pushes `orb-code-agent-model` over existing Host process IPC when Host is ready and when the user changes Background Agent Settings. Desktop Host plugin `computer-use-orb-code-agent-model` publishes optional `ctx.orbCodeAgentModel`. `code_agent` `ctx.get('orbCodeAgentModel')` only in the `session_id === undefined` arm, after create and before prompt. Continue is unchanged. Web/headless without the service keep inheriting `agent-default-model`. The experimental package does not import desktop-host.

[Desktop floating orb](2026-09-14-desktop-floating-orb.md) remains the owner of overlay construction, first-class `code_agent` sessions, and the runtime extra.

## Alternatives considered

**Write the fields into `floating-session.json`.** `writeFloatingSessionId` rewrites the whole object and would couple session identity to model prefs.

**Keep writing `agent-default-model`.** Overlay and background picks would change main-window New Chat.

**Apply the background selection on `code_agent` continue.** That would retarget an in-flight standard session the user may already be chatting with in the sidebar.

**Filter overlay models to image-capable routes.** The ball's Computer Use session needs vision, but the catalog menu matches the main-window picker; an unsupported route fails `selectModel` and leaves the session on its current model.

**Put a `/model` popup on the compact overlay.** Native nested menus reuse the Host catalog without a second Client picker on the 72px ball.

**Import `@deepseek-ai/dsh-desktop-host` from the experimental package.** Release apps must not name experimental packages, and the reverse import would couple Computer Use to Electron. Optional `ctx.get` is the Host-side seam.

## Consequences

Main-window composer default stays independent of the ball. Closing and reopening the overlay keeps the last overlay route. A new `code_agent` on Desktop uses the last background route; continue-by-id does not. Missing Host service is silent inheritance of `agent-default-model`, not a load failure. `code_agent` tool schema and POLICY stay silent about this UI pref.

## Testing

`floating-window.spec.ts` pins submenu placement versus Open Main / toolbar / Quit and independent checkmarks. `floating-agent-menu.spec.ts` pins empty catalog, radio versus checkbox, Default radio, and no empty submenu. `orb-agent-models.spec.ts` pins defaults, invalid JSON, and independent round-trip. `floating-renderer.spec.ts` pins stored overlay `selectModel` with `saveAsDefault: false` and live menu apply. `session-models.host.spec.ts` pins skip versus persist of `agent-default-model`. `code-agent.spec.ts` pins create-only `selectModel` when the service is present and an unchanged create payload when it is omitted. Desktop Host plugin tests and Electron `setOrbCodeAgentModel` IPC cover the push. Overlay YAML id and locale menu labels are pinned.
