# Agent Note: Overlay Computer Use millifraction and pixel coordinate modes

Status: proposed

English | [中文](2026-09-19-computer-use-session-coordinate-modes.zh.md)

## Problem

Computer Use click, type, scroll, drag, and long-press `position` values are 0–1000 fractions of the attached frontmost-window screenshot. The host maps each axis independently onto that window's logical bounds, then posts HID. [Computer Use 0–1000 fraction coordinates](../../implemented/bug-fix/2026-09-15-computer-use-fraction-coordinates.md) owns that space. POLICY, the first-frame notice, tool `position` descriptions, and `<coordinate_space>0-1000</coordinate_space>` already tell the model to encode `x` and `y` as screenshot fraction × 1000 (center `x` is 500, not a pixel column) and not to send raw pixels. [Image handle omits request-preview pixels](../../implemented/bug-fix/2026-09-15-omit-request-preview-handle-dimensions.md) hides preview `WxHpx` so those numbers cannot look like a click space.

Some vision models still emit screenshot-sized integers such as `[754, 155]` on a ~1470-wide window. The host treats them as 75.4% / 15.5%. On a wide, short screenshot that lands far right and slightly high — the systematic miss users report on GLM-class routes, and sometimes DeepSeek. Qwen- and Doubao-class routes more often emit 0–1000 already. The miss is frequently a **coordinate encoding**, not a failure to see the control: after a few wrong clicks, or after an explicit ÷ width × 1000 conversion, the same model hits the target. Prompt-only pressure reduces but does not remove first-click encoding errors. A second encoding must exist for overlay Computer Use: pixels of the attached screenshot.

## Proposal

Keep **one** Computer Use plugin and the same thirteen GUI tools. Add two encodings of the same geometric fraction (position on the attached screenshot, then × the window's logical size). Switch encodings only by creating a new overlay conversation. Each conversation keeps the encoding it was created with for its whole life.

This control is a Desktop overlay product. Headless, Web, and other Computer Use compositions stay on 0–1000 until a later Config explicitly opts them in. [Experimental Computer Use](../../implemented/feature/2026-09-13-experimental-computer-use.md) still owns the tools, first-frame attach, and HID. [Desktop floating orb](../../implemented/feature/2026-09-14-desktop-floating-orb.md) still owns overlay session create, History, New, and `floating-session.json`.

### Two encodings of one screenshot fraction

Both modes compute `logicalX = window.x + fractionX × window.width` (and the same for `y`). They differ only in how the model writes `fractionX`:

| Mode | Model `position` `x` | Host fraction | Envelope |
|---|---|---|---|
| Millifraction (default) | 0–1000 | `x / 1000` | `<coordinate_space>0-1000</coordinate_space>` only; no pixel sizes |
| Pixel | Column on **this observation's attached image** | `x / attachedWidth` | pixel space plus that attachment's `WxH` |

Pin pixels to the raster attached in **that** observation, not capture backing pixels, Retina scale, logical window points, or a later request-preview resize. The `WxH` in the envelope and the divisor in the mapper must be the same pair. POLICY, the first-frame notice, `position` descriptions, click-result copy, validation, and the mapper must describe that same encoding on every request of that session. Do not hide millifraction copy while still dividing by 1000, and do not show 0–1000 copy while dividing by image width.

### Overlay default versus session contract

There are two facts, and they may disagree:

1. **Desktop default for new overlay Computer Use sessions** — what the right-click item and the main-window Settings switch reflect. Default is millifraction on. Persist it next to other orb prefs (same class of file as `selection-toolbar.json` / `orb-agent-models.json`), not inside `floating-session.json`.
2. **Per-session contract** — the encoding recorded on that overlay session at create, reconstructable from the session log because it is model-visible. POLICY, tool schemas, envelopes, validation, and mapping for a request read **this session's** contract, not the current Desktop default.

Continuing an old millifraction session after the user has turned millifraction off still uses millifraction. New overlay sessions after that toggle, including overlay New, use pixel. History adopt must not restamp the session contract from the Desktop default. Overlay create, History adopt, and New already re-apply the stored overlay **model** with `saveAsDefault: false` ([floating-ball Agent model menus](../../implemented/feature/2026-09-17-orb-agent-model-menus.md)); coordinate encoding is not that field and must not ride `selectModel`.

The standing `tool:computer-use` system-prompt section is process-global today. This product requires the assembled POLICY, parameter descriptions, and mapping for a request to follow the session being prompted.

### Overlay menu and Settings page

Place a single checkbox-style item on the overlay native menu at the same level as the selection-toolbar row, immediately below it, still above Quit. Do not put it in Floating Agent Settings or Background Agent Settings, and do not put it on each model submenu. [Desktop selection toolbar](../../implemented/feature/2026-09-16-desktop-selection-toolbar.md) owns the selection-toolbar row; this item is a sibling, not a child. Background Agent Settings is `code_agent` and has no desktop click space.

The [Desktop orb Settings](../../implemented/feature/2026-09-18-desktop-orb-settings.md) page adds a sibling card after the selection-toolbar card: title, description, and a `Switch` bound to the same Desktop default (checked means millifraction on). Copy is locale-owned in the orb Settings dictionary, like the selection toolbar. On Windows the whole orb page stays disabled, including this switch.

Native-menu copy follows the selection-toolbar pattern (current state, action to invert): millifraction on → **Disable millifraction coordinates** / **关闭千分比坐标**; millifraction off → **Enable millifraction coordinates** / **打开千分比坐标**. The menu label and the Settings switch both show the Desktop default for the next new overlay session, not a live readout of the open conversation. A user sitting in an old millifraction transcript while the default is already pixel still sees the default as off.

Neither control may mutate the open session's contract. The selection-toolbar switch persists immediately; the coordinate control must not. Opening either control shows confirmation (native dialog from the shell, not a card inside the 72px ball): the new encoding takes effect in a **new** conversation; the current conversation is unchanged and remains in History. Cancel leaves the control, the default, and the session as they were — do not flip the Settings switch and then revert. Confirm runs **one** apply path shared by the menu and Settings: write the inverted default, create a blank overlay Computer Use session with that encoding through the existing overlay New / `session.create` path (do not invent a second create in the Settings renderer), and point `floating-session.json` at it. The previous session stays under the `dsh_orb` workspace. Do not hot-swap POLICY inside the old log.

### Shared tools, forked contract

Do not mount a second Computer Use plugin and do not register a second `click`. Tool names, exclusivity, recapture, and HID stay one path. `execute` reads the session contract, turns `position` into a screenshot fraction, then reuses the existing global mapping. `drag` start and end use the same encoding. Pixel mode lifts the 0–1000 clamp and validates against the attached image size of the observation being clicked.

### Persistence and History

Append a required-on-read session fact for the encoding (a plugin notice or a dedicated `SessionEventMap` member). Ordinary event vocabulary growth does not bump `SESSION_FORMAT_VERSION`; do not mark the fact `ignorable: true` — a reader that skipped it would mis-map stored `position` arrays. Pixel-mode observations must log the attached `WxH` used as the divisor. Overlay History, overlay composer continue, and the main-window sidebar row for the same `dsh_orb` session all honor that recorded encoding.

## Alternatives considered

**Prompt-only millifraction, no second encoding.** Shipped POLICY already names × 1000 and forbids pixels. GLM-class first clicks still miss with a wide-screenshot bias. The product needs a pixel encoding, not a longer prompt.

**A global dropdown or a Settings switch that retargets the live session.** Swapping POLICY in an existing transcript mixes two encodings in one log. The chosen product creates a new session instead.

**Persist the Settings switch immediately, like the selection toolbar, then confirm.** That would flip the default before the user agrees to a new conversation, and Cancel would have to undo a write. Confirm first; only then write and create.

**A per-model submenu checkbox beside thinking effort.** Switching encoding still requires a new session, so binding it to a catalog model row implies a new chat when picking GLM. Electron forbids a checkbox item that also has a `submenu`; models without reasoning are leaves today, so every overlay model would become a nested menu. The encoding is an overlay-session contract, not a model attribute.

**Two Computer Use plugins (millifraction package vs pixel package).** Duplicates thirteen tools, first-frame attach, consent, and the macOS backend. Unmounting one plugin to mount the other is not a session switch. One plugin with two encodings is the composition.

**Host auto-detect: treat numbers that look like pixels as pixels.** `[754, 155]` is legal in both spaces. Auto-detect cannot decide. The session contract is explicit.

**Pixel mode without showing `WxH`.** Capture pixels, attachment pixels, request-preview pixels, and logical points differ. Showing sizes caused the original 0–1000 bug when they were *not* the click space; in pixel mode the attached `WxH` *is* the click space and must appear on the observation.

**Apply the Desktop default when History adopts a session, the way overlay model is re-applied.** That would rewrite an old millifraction conversation into pixel (or the reverse) and break the product rule.

## Acceptance criteria

- A new overlay Computer Use session defaults to millifraction 0–1000 with no attached pixel sizes on the envelope.
- The overlay native menu (below the selection-toolbar item, above Quit) and the main-window orb Settings switch invert that default only after the same confirm. Confirm creates a blank overlay session in the other encoding through the shared overlay New path and does not alter the previous session's contract. Cancel is a no-op and does not flash the Settings switch. The Settings card matches the selection-toolbar card; Windows keeps it disabled with the rest of the orb page.
- After millifraction is disabled, overlay New and later overlay creates use pixel mode: envelope names the attached image `WxH`, POLICY and `position` copy match pixels, and HID mapping divides by that `WxH`.
- Reopening a millifraction History row and sending a new user message still maps `position` as 0–1000, even when the Desktop default is pixel. The same holds from the main-window `dsh_orb` sidebar.
- Background Agent Settings has no coordinate item. Headless/Web Computer Use snapshots remain millifraction-only unless this proposal is later extended.
- A recorded overlay snapshot (or owner-local equivalent) pins both encodings, the confirm-then-create path, and History continue on the birth encoding. Locale copy is dictionary-owned.

## Risks

Pixel mode reintroduces a raster to the model. If request projection resizes after attach, the model may still count a different grid than the envelope `WxH`; millifraction exists to avoid that gap, and pixel mode only helps models whose native tokens match the attached raster. Users who disable millifraction and then pick a Qwen-class model on a **new** session will click in pixel space until they enable millifraction again and confirm another new chat. Menu copy and the Settings switch show the default, not the open transcript, which can look wrong while History is focused; the confirm copy must state that the current conversation is unchanged.
