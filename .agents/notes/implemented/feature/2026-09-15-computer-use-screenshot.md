# Agent Note: Computer Use screenshot export

Status: implemented

English | [中文](2026-09-15-computer-use-screenshot.zh.md)

## Problem

Users ask Computer Use to take a screenshot they can paste or keep. Observation already attaches screens to the model, so an observe tool would waste a turn. Durable attachments live under `DSH_HOME` and never tell the model a Desktop path. [Experimental Computer Use](2026-09-13-experimental-computer-use.md) still owns the plugin and exclusive GUI path.

## Decision

`screenshot` is an exclusive GUI export. It captures the current frontmost window (same overlay-skip pipeline as observation), writes that raster onto the user's Desktop with a macOS-style `Screenshot YYYY-MM-DD at HH.MM.SS` name, copies it onto the system pasteboard, and returns those paths in the tool result text together with the usual observation images. Missing or empty writes fail loud. The tool takes no arguments. 1s `wait` remains how the model refreshes a loader.

Policy tells the model not to call `screenshot` merely to see the window. `copyImageToClipboard` is not HID and stays unwrapped by overlay-guard. The pasteboard is replaced, not restored. [Computer Use focused-window observation](2026-09-16-computer-use-focused-window-observation.md) owns the window capture.

## Alternatives considered

**Observe/screenshot tool for vision only.** Observation already lives in the first user turn and every GUI result.

**Save into the attachment store only.** The model would still lack a user-visible path, and paste would not work.

**Optional destination path.** Desktop is the Finder default, like omitted `open_in_finder`. A path argument would reopen the open-path blacklist.

**Restore the previous clipboard.** The user asked for the image to be on the clipboard. `input_text` still restores only the previous string after paste.

## Consequences

The Computer Use catalog is thirteen exclusive GUI tools plus `code_agent`. Window capture writes one file and copies that image. `input_text` after `screenshot` overwrites that image with a string. Overlay-guard is unchanged for HID.

## Testing

Package tests write into a temp home Desktop, spy `writeDesktopScreenshots` from the plugin tests, and record fake `copyImageToClipboard`. macOS tests inject a command runner for the NSPasteboard JXA. The authored [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) header pin refreshes `system-prompt.expected.md` and `tool-schemas.expected.json`.
