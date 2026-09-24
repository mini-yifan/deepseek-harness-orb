# Agent Note: Overlay Computer Use millifraction and pixel coordinate modes

Status: implemented

English | [中文](2026-09-19-computer-use-session-coordinate-modes.zh.md)

## Problem

Computer Use click, type, scroll, drag, and long-press `position` values are 0–1000 fractions of the attached frontmost-window screenshot. The host maps each axis independently onto that window's logical bounds, then posts HID. [Computer Use 0–1000 fraction coordinates](../bug-fix/2026-09-15-computer-use-fraction-coordinates.md) owns that space. POLICY, the first-frame notice, tool `position` descriptions, and `<coordinate_space>0-1000</coordinate_space>` already tell the model to encode `x` and `y` as screenshot fraction × 1000 (center `x` is 500, not a pixel column) and not to send raw pixels. [Image handle omits request-preview pixels](../bug-fix/2026-09-15-omit-request-preview-handle-dimensions.md) hides preview `WxHpx` so those numbers cannot look like a click space.

Some vision models still emit screenshot-sized integers such as `[754, 155]` on a ~1470-wide window. The host treats them as 75.4% / 15.5%. On a wide, short screenshot that lands far right and slightly high — the systematic miss users report on GLM-class routes, and sometimes DeepSeek. Qwen- and Doubao-class routes more often emit 0–1000 already. The miss is frequently a **coordinate encoding**, not a failure to see the control: after a few wrong clicks, or after an explicit ÷ width × 1000 conversion, the same model hits the target. Prompt-only pressure reduces but does not remove first-click encoding errors. A second encoding must exist for overlay Computer Use: pixels of the attached screenshot.

## Decision

Keep **one** Computer Use plugin and the same thirteen GUI tools. Add two encodings of the same geometric fraction (position on the attached screenshot, then × the window's logical size). Switch encodings only by creating a new overlay conversation. Each conversation keeps the encoding it was created with for its whole life.

This control is a Desktop overlay product. Headless, Web, and other Computer Use compositions stay on 0–1000 until a later Config explicitly opts them in. [Experimental Computer Use](2026-09-13-experimental-computer-use.md) still owns the tools, first-frame attach, and HID. [Desktop floating orb](2026-09-14-desktop-floating-orb.md) still owns overlay session create, History, New, and `floating-session.json`.

### Two encodings of one screenshot fraction

Both modes compute `logicalX = window.x + fractionX × window.width` (and the same for `y`). They differ only in how the model writes `fractionX`:

| Mode | Model `position` `x` | Host fraction | Envelope |
|---|---|---|---|
| Millifraction (default) | 0–1000 | `x / 1000` | `<coordinate_space>0-1000</coordinate_space>` only; no pixel sizes |
| Pixel | Column on **this observation's attached image** | `x / attachedWidth` | pixel space plus that attachment's `WxH` |

Pin pixels to the raster attached in **that** observation, not capture backing pixels, Retina scale, logical window points, or a later request-preview resize. The `WxH` in the envelope and the divisor in the mapper are the same pair from `ObservedScreen.image.width/height` after `saveImage`. POLICY, the first-frame notice, `position` descriptions, click-result copy, validation, and the mapper describe that same encoding on every request of that session. `drag` start and end use the same encoding. Pixel clicks without an attached raster fail; they do not fall back to 1000.

### Overlay default versus session contract

There are two facts, and they may disagree:

1. **Desktop default for new overlay Computer Use sessions** — what the right-click item and the main-window Settings switch reflect. Default is millifraction on. Persist it in `millifraction-coordinates.json` next to other orb prefs, not inside `floating-session.json`.
2. **Per-session contract** — `'computer-use/coordinate-mode'` on that overlay session at blank create, reconstructable from the session log because it is model-visible. Not ignorable and not a plugin notice: a skipped notice would still map as 0–1000. POLICY, tool schemas, envelopes, validation, and mapping for a request read **this session's** contract, not the current Desktop default. Ordinary event vocabulary growth does not bump `SESSION_FORMAT_VERSION`.

Continuing an old millifraction session after the user has turned millifraction off still uses millifraction. New overlay sessions after that toggle, including overlay New, use pixel. History adopt must not restamp the session contract from the Desktop default: a log that already has the encoding event or `session/end-seed` is left unchanged. Overlay create, History adopt, and New still re-apply the stored overlay **model** with `saveAsDefault: false` ([floating-ball Agent model menus](2026-09-17-orb-agent-model-menus.md)); coordinate encoding is not that field and does not ride `selectModel`.

The `tool:computer-use` system-prompt section is a `(context) =>` function. Assemblies without an agent stay millifraction. Assemblies with an agent follow that session's log. Five `position` tools are rewritten on the assemble waterfall in pixel mode; `dsh-tools.wireSchemas` stays millifraction.

Desktop Host plugin `computer-use-orb-coordinate-mode` publishes optional `ctx.orbCoordinateMode`. Computer Use `ctx.get('orbCoordinateMode')` only on blank create. The experimental package does not import desktop-host. Electron pushes `orb-coordinate-mode` over Host IPC when Host is ready and after the user confirms a default change.

### Overlay menu and Settings page

A checkbox-style item sits on the overlay native menu at the same level as the selection-toolbar row, immediately below it, still above Quit. It is not in Floating Agent Settings or Background Agent Settings, and not on each model submenu. [Desktop selection toolbar](2026-09-16-desktop-selection-toolbar.md) owns the selection-toolbar row; this item is a sibling, not a child. Background Agent Settings is `code_agent` and has no desktop click space.

The [Desktop orb Settings](2026-09-18-desktop-orb-settings.md) page adds a sibling card after the selection-toolbar card: title, description, and a `Switch` bound to the same Desktop default (checked means millifraction on). Copy is locale-owned in the orb Settings dictionary. On Windows the whole orb page stays disabled, including this switch.

Native-menu copy follows the selection-toolbar pattern (current state, action to invert): millifraction on → **Disable millifraction coordinates** / **关闭千分比坐标**; millifraction off → **Enable millifraction coordinates** / **打开千分比坐标**. The menu label and the Settings switch both show the Desktop default for the next new overlay session, not a live readout of the open conversation.

Neither control mutates the open session's contract. Opening either control shows confirmation (native dialog from the shell). Cancel writes nothing, creates nothing, and does not flip the Settings switch. Confirm runs **one** apply path shared by the menu and Settings: write the inverted default, push Host, and send overlay New IPC so `floating.js` calls existing `createOrbSession()`. The Settings renderer does not `session.create`. The previous session stays under the `dsh_orb` workspace.

### Shared tools, forked contract

There is not a second Computer Use plugin and not a second `click`. Tool names, exclusivity, recapture, and HID stay one path. HID still consumes millifraction internally. `execute` reads the session contract, turns `position` into a screenshot fraction, then reuses the existing global mapping.

## Alternatives considered

**Prompt-only millifraction, no second encoding.** Shipped POLICY already names × 1000 and forbids pixels. GLM-class first clicks still miss with a wide-screenshot bias. The product needs a pixel encoding, not a longer prompt.

**A global dropdown or a Settings switch that retargets the live session.** Swapping POLICY in an existing transcript mixes two encodings in one log. The chosen product creates a new session instead.

**Persist the Settings switch immediately, like the selection toolbar, then confirm.** That would flip the default before the user agrees to a new conversation, and Cancel would have to undo a write. Confirm first; only then write and create.

**A per-model submenu checkbox beside thinking effort.** Switching encoding still requires a new session, so binding it to a catalog model row implies a new chat when picking GLM. Electron forbids a checkbox item that also has a `submenu`; models without reasoning are leaves today, so every overlay model would become a nested menu. The encoding is an overlay-session contract, not a model attribute.

**Two Computer Use plugins (millifraction package vs pixel package).** Duplicates thirteen tools, first-frame attach, consent, and the macOS backend. Unmounting one plugin to mount the other is not a session switch. One plugin with two encodings is the composition.

**Host auto-detect: treat numbers that look like pixels as pixels.** `[754, 155]` is legal in both spaces. Auto-detect cannot decide. The session contract is explicit.

**Pixel mode without showing `WxH`.** Capture pixels, attachment pixels, request-preview pixels, and logical points differ. Showing sizes caused the original 0–1000 bug when they were *not* the click space; in pixel mode the attached `WxH` *is* the click space and must appear on the observation.

**Apply the Desktop default when History adopts a session, the way overlay model is re-applied.** That would rewrite an old millifraction conversation into pixel (or the reverse) and break the product rule.

**A plugin notice as the session contract.** Notices are `user/message`; old readers would not refuse the log and would still map as 0–1000. The dedicated required-on-read event is the contract.

## Consequences

Pixel mode reintroduces a raster to the model. If request projection resizes after attach, the model may still count a different grid than the envelope `WxH`; millifraction exists to avoid that gap, and pixel mode only helps models whose native tokens match the attached raster. Users who disable millifraction and then pick a Qwen-class model on a **new** session click in pixel space until they enable millifraction again and confirm another new chat. Menu copy and the Settings switch show the default, not the open transcript, which can look wrong while History is focused; the confirm copy states that the current conversation is unchanged. Headless/Web snapshots stay millifraction. A reader that does not know `'computer-use/coordinate-mode'` refuses the log.

## Testing

Computer Use package tests pin millifraction mapping, pixel `x/attachedWidth × bounds`, out-of-range pixel rejection, missing-raster failure, millifraction envelopes without `WxH`, pixel envelopes with attached `WxH`, two sessions in one process assembling different POLICY and `position` copy, blank-create stamp versus `session/end-seed` adopt, and drag start/end sharing one encoding. Existing tools/pre-step/envelope pins stay millifraction.

Desktop tests pin menu order (below selection, above Quit), confirm cancel (JSON unchanged, no create, Settings switch does not flash), confirm success (JSON invert, Host push, overlay `createOrbSession`), History adopt still `selectModel` without restamping encoding, and the Settings card plus Windows disablement. Headless [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) stays millifraction. Pixel model-visible text is owner-local in the package tests.
