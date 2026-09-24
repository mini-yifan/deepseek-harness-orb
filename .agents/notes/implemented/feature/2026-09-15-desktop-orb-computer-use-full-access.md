# Agent Note: Desktop orb Computer Use full access

Status: implemented

English | [中文](2026-09-15-desktop-orb-computer-use-full-access.zh.md)

## Problem

Desktop Host permission presets pin `workspace-write` and approval `ask` on every new session. The macOS floating ball creates Computer Use on `$DSH_HOME/dsh_orb`, so bash and filesystem cannot mkdir or write on Desktop or Documents. GUI click/type is already unsandboxed.

## Decision

The Desktop Host plugin `computer-use-orb-permission` listens on `session/created` after the Host pin and calls `permissionPresets.set` with the live overlay Access preset when `session.header.agentPreset` is `computer-use` or `standard` and `session.header.cwd` resolves to `join(resolveDshHome(), 'dsh_orb')` or a real subdirectory of that path. The live preset is the Electron-pushed overlay preference, default `danger-full-access` before the first push. `set` appends nothing when that preset is already current. A fresh Computer Use create logs `workspace-write` then the overlay preset when they differ. The plugin does not walk `ctx.sessions.list()` at apply. Computer Use on a different workspace stays on the Host default so the main-window Access chip still works there.

[Overlay Access picker and shared orb permission](2026-09-17-overlay-access-picker.md) owns the overlay chip, `orb-permission.json`, overlay-send `/permission` reapply, and sharing that preset with background `code_agent`. [Desktop floating orb](2026-09-14-desktop-floating-orb.md) owns overlay create. The archived [workspace-write surface default](../../archived/feature/2026-07-31-workspace-write-surface-default.md) stays historical.

The plugin injects `permissionPresets` and `sessions` and is a no-op when either service is absent. Overlay YAML loads `../lib/computer-use-orb-permission.js`. The renderer `session.create` payload is `{ agentPreset: 'computer-use', workspaceId }`.

## Alternatives considered

**Change `packages/bundle/base/cordis.patch.yml` or Settings `permission.defaultPreset`.** That would unsandbox Web, TUI, and main-window coding sessions.

**Pin every Computer Use session.** Main-window Computer Use on another workspace must keep Workspace Write and the Access chip.

**Pass a permission preset from `floating.js` create.** Host still pins on `session/created`; overlay create does not grow a sandbox field. Overlay send applies `/permission` separately, owned by the Access picker note.

## Consequences

Orb Computer Use and new `dsh_orb` (or subdirectory) standard / `code_agent` sessions follow the stored overlay Access for bash and filesystem. Opening that session in the main window shows the same preset until the user changes the Access chip there. GUI Computer Use consent remains the experimental install/patch gate.

## Testing

Desktop Host tests pin Computer Use plus orb cwd and standard plus orb cwd or an orb subdirectory to the live overlay preset (shipped default `danger-full-access`), leave Computer Use plus another cwd and a sibling of `dsh_orb` unchanged, append nothing when that preset is already current, and leave an already-announced orb Computer Use session unchanged at apply. Overlay YAML contains the plugin id and path. The floating renderer create payload stays `{ agentPreset: 'computer-use', workspaceId }`. The `snapshots/session/computer-use` fixture is not refreshed; live headless create is not the orb path.
