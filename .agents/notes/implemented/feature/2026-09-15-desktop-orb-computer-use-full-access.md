# Agent Note: Desktop orb Computer Use full access

Status: implemented

English | [中文](2026-09-15-desktop-orb-computer-use-full-access.zh.md)

## Problem

Desktop Host permission presets pin `workspace-write` and approval `ask` on every new session. The macOS floating ball creates Computer Use on `$DSH_HOME/dsh_orb`, so bash and filesystem cannot mkdir or write on Desktop or Documents. The overlay has no Access chip, and GUI click/type is already unsandboxed.

## Decision

The Desktop Host plugin `computer-use-orb-permission` listens on `session/created` after the Host pin and calls `permissionPresets.set(session, 'danger-full-access')` when `session.header.agentPreset` is `computer-use` and `session.header.cwd` resolves to `join(resolveDshHome(), 'dsh_orb')`. It walks `ctx.sessions.list()` at apply so a Host reopen upgrades an already-announced orb Computer Use session. `set` appends nothing when that preset is already current. A fresh create logs `workspace-write` then `danger-full-access`. A main-window Access-chip downgrade on that same `dsh_orb` Computer Use session is overwritten the next time Host announces it. The ball has no picker, so Full access confirmation does not run.

`standard` sessions on `dsh_orb`, including `code_agent` children, stay on the Host `workspace-write` default. Computer Use on a different workspace stays on that default so the main-window Access chip still works. [Desktop floating orb](2026-09-14-desktop-floating-orb.md) owns overlay create. The archived [workspace-write surface default](../../archived/feature/2026-07-31-workspace-write-surface-default.md) stays historical.

The plugin injects `permissionPresets` and `sessions` and is a no-op when either service is absent. Overlay YAML loads `../lib/computer-use-orb-permission.js`. The renderer `session.create` payload is `{ agentPreset: 'computer-use', workspaceId }`.

## Alternatives considered

**Change `packages/bundle/base/cordis.patch.yml` or Settings `permission.defaultPreset`.** That would unsandbox Web, TUI, and main-window coding sessions.

**Pin every Computer Use session.** Main-window Computer Use on another workspace must keep Workspace Write and the Access chip.

**Pin every session whose cwd is `dsh_orb`.** Background `code_agent` / `standard` rows must keep the Host default.

**Pass a permission preset from `floating.js`.** Host owns the pin; the overlay create payload does not grow a sandbox field.

**Add an Access chip to the ball.** The overlay has no picker by design, and Full access confirmation would have no host.

## Consequences

Orb Computer Use bash and filesystem can write outside `dsh_orb` without per-command approval. Opening that session in the main window shows Full access. A user who downgrades it there loses the downgrade on the next Host announce or reopen. GUI Computer Use consent remains the experimental install/patch gate.

## Testing

Desktop Host tests pin Computer Use plus orb cwd to last preset `danger-full-access`, leave `standard` plus orb cwd and Computer Use plus another cwd unchanged, and append nothing when Full access is already current. Overlay YAML contains the plugin id and path. The floating renderer create payload stays `{ agentPreset: 'computer-use', workspaceId }`. The `snapshots/session/computer-use` fixture is not refreshed; live headless create is not the orb path.
