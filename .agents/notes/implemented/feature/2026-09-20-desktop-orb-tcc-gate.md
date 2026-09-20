# Agent Note: Desktop Orb TCC gate and DeepSeek Orb display name

Status: implemented

English | [中文](2026-09-20-desktop-orb-tcc-gate.zh.md)

## Problem

Computer Use on macOS needs Screen Recording to capture and Accessibility to post HID. Finder Automation is only required when a turn talks to Finder. The plugin fails those calls with a named TCC message and does not prompt, so overlay send could start a turn that immediately failed. Packaged Electron `app.name` was DeepSeek Harness, which is the repo, CLI, and main-window Web UI brand, not the identity System Settings lists for the desktop shell.

## Decision

The Desktop overlay covers the expanded `#panel` (transcript plus composer) on the first `setExpanded(true)` when Screen Recording or Accessibility is not granted to this process. Each row opens that System Settings pane (`Privacy_ScreenCapture` / `Privacy_Accessibility`). Later and the dismiss control only hide the layer; the next expand or send that still lacks a right shows it again. Overlay Enter and selection-toolbar Translate call `session/prompt` only after both rights are `granted`; the composer draft stays. When both probes report granted, the cover hides with no confirm click. Users who already granted both rights never see it. Windows and Linux treat TCC as inapplicable and skip the cover.

Each right is `missing`, `granted`, or `needsRelaunch`. After the user opens a pane that is still off, the overlay offers Quit and reopen (`app.relaunch()` then `app.quit()`). Closing the main window is not quit. `app` activate and overlay focus republish the snapshot. Copy interpolates `app.name`: DeepSeek Orb when packaged, Electron under `pnpm run start:desktop`.

Finder Automation stays out of this cover. `mac.extendInfo.NSAppleEventsUsageDescription` lets the first `tell application "Finder"` show the system prompt.

Packaged `productName` is DeepSeek Orb. `appId` is unchanged so existing TCC grants survive. Repo, CLI, `dsh`, and main-window Web UI copy stay DeepSeek Harness. Settings → Floating ball shows a macOS status card after millifraction; Windows keeps that page disabled and omits the card.

The Computer Use plugin still does not prompt. Execute still names TCC when a right is missing at capture or HID. [Experimental Computer Use](2026-09-13-experimental-computer-use.md) owns those execute failures.

## Alternatives considered

**A second Electron window for the permission tutorial.** That would be more always-on-top chrome to exclude from capture and would not sit on the overlay send path.

**Prompt from `tool-computer-use` at first GUI execute.** The plugin runs in the Host Node child, cannot open System Settings as the signed app identity, and would still let overlay send start a turn that fails on the first capture or click.

**Put Finder Automation on the two-row cover.** The system already prompts on the first AppleEvent. Asking earlier would request a right most sessions never use.

**Change `appId` with the display name.** Screen Recording and Accessibility grants are keyed by bundle id; a new id would look like a different app in System Settings.

**A permanent skip.** Send would then need a hard block with no remaining UI, or would start Computer Use without the rights the tools require.

## Consequences

Unauthorized overlay send cannot start a Computer Use turn. Users who grant both rights and fully quit then reopen never see the cover again. Source-launch System Settings identity is Electron, not DeepSeek Orb. Finder still prompts at first use. Web `--patch` compositions have no overlay cover.

## Testing

Desktop overlay tests cover first-expand cover, granted skip, blocked send with no `session/prompt` and a surviving draft, Later then send showing the cover again, `needsRelaunch` Quit and reopen, and a granted push hiding the cover. Main-process tests map TCC probes, open the Settings URLs, and republish on activate and overlay focus. Settings tests render the macOS card and call `openTcc`. Packaging tests pin `productName` DeepSeek Orb, `.app` / `.exe` paths, and `NSAppleEventsUsageDescription`. Computer Use `macos.ts` still names TCC on execute failure and does not prompt.
