# Agent Note: Overlay Access picker and shared orb permission

Status: implemented

English | [中文](2026-09-17-overlay-access-picker.zh.md)

## Problem

The floating-ball panel had no Access control. Desktop Host hardcoded Full access on overlay Computer Use, left background `code_agent` on Workspace Write, and a main-window Access-chip change on that Computer Use session could stick while the user kept chatting there — or get overwritten without the ball showing which preset overlay work would use.

## Decision

The expanded overlay header places an Access chip between History and New. The chip shows the selected label (`Read Only` / `Workspace Write` / `Full access`, locale-owned) and opens a dropdown of those three ids (`read-only` / `workspace-write` / `danger-full-access`). Full access has no confirmation dialog. The chip follows the same vertical edge as History and New; [overlay History and New follow the input-pill edge](../bug-fix/2026-09-17-overlay-history-new-follow-expand.md) owns that placement.

The selection persists as Desktop profile `orb-permission.json` (`{ preset }`). Absent or invalid JSON uses `danger-full-access`. Electron pushes `orb-permission` over existing Host process IPC when Host is ready and when the overlay chip changes. Desktop Host plugin `computer-use-orb-permission` stores that live preset (shipped default Full access before the first push) and on `session/created` calls `permissionPresets.set` when `agentPreset` is `computer-use` or `standard` and `cwd` resolves to `join(resolveDshHome(), 'dsh_orb')` or a real subdirectory of that path. `set` appends nothing when that preset is already current. The plugin does not walk `sessions.list()` at apply, so a main-window Access-chip change on an already-listed session stays until overlay work reapplies.

Overlay composer submit, selection-toolbar prompt, and a chip pick persist the chip through Desktop IPC. When that IPC names the live overlay session, the Host plugin pins that session with `permissionPresets.set` and does not call `commands/execute`. Overlay send still queues `session/prompt` if Access persist is missing. A main-window Access-chip change therefore remains while the user keeps chatting in the main window, and overlay chat or an overlay chip pick writes the header preset back onto that session. New `code_agent` / standard sessions on `dsh_orb` or a subdirectory receive the live overlay preset at create. Computer Use or `code_agent` cwd outside that tree stays on the Host default so the main-window Access chip still works there. [Overlay Computer Use background dispatch](2026-09-17-orb-code-agent-dispatch.md) owns minting those subdirectories.

[Desktop orb Computer Use full access](2026-09-15-desktop-orb-computer-use-full-access.md) remains the owner of not changing the profile `permission.defaultPreset` and of not pinning every Computer Use session. [Desktop floating orb](2026-09-14-desktop-floating-orb.md) owns overlay construction and `code_agent` create.

## Alternatives considered

**Keep a hardcoded Full-access pin and no overlay chip.** The ball would not show or persist a user Access choice, and overlay work could not reapply a stored weaker preset.

**Reuse the React `PermissionSelect` on the overlay document.** `floating.html` is vanilla JS, not the Client composer; Full access confirmation would also have no host on the ball.

**Walk `sessions.list()` whenever Electron pushes a preset.** That would overwrite a main-window Access-chip change on every matching `dsh_orb` session without overlay chat.

**Apply the overlay preset only to Computer Use.** Background `code_agent` would keep a different sandbox than the chip the user just set.

**Store the preset in `floating-session.json`.** Session identity would couple to Access, and `writeFloatingSessionId` rewrites the whole object.

## Consequences

GUI click/type stay unsandboxed. Overlay bash and filesystem, and new `dsh_orb` (or subdirectory) standard / `code_agent` sessions, follow the stored overlay Access. A user who downgrades in the main window and keeps chatting there keeps that downgrade until they send from the ball or pick on the overlay chip. Restarting Desktop keeps the last overlay Access file.

## Testing

Desktop persist tests default missing JSON to `danger-full-access` and round-trip `workspace-write` / `read-only`. Host tests pin Computer Use and standard on orb cwd and an orb subdirectory to the live preset, leave Computer Use on another cwd and a sibling of `dsh_orb` unchanged, append nothing when current, leave an already-announced orb Computer Use session unchanged at apply, and pin an attached orb session when Electron pushes that session id. Overlay renderer tests place the chip between History and New, show Full access, persist a Workspace Write pick with the session id, call Desktop IPC before `session/prompt` on overlay send and selection-toolbar prompt, and still send when Access IPC is missing. Electron tests push `danger-full-access` at Host ready.
