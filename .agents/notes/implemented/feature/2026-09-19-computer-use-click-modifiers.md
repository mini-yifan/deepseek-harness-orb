# Agent Note: Computer Use click modifiers

Status: implemented

English | [中文](2026-09-19-computer-use-click-modifiers.zh.md)

## Problem

Computer Use can click, but it cannot Shift-click or Cmd-click. File pickers that have no bash path need those chords to multi-select. Separate hold and release modifier tools would leave the key down if the model forgot, the turn aborted, or compaction dropped the hold.

## Decision

`click` takes optional `modifiers`: `shift`, `cmd`/`command`/`meta`/`win`/`windows`/`super`, `option`/`alt`, and `control`/`ctrl`. Execute rejects any other token, including letters and `fn`, before HID. Omit or `[]` is a plain click. Duplicate families keep the first token.

macOS posts one osascript: modifier keyDown, `clickAt` with the same CGEvent flags on the mouse events, then modifier keyUp. The tool result names modifiers when present. Policy tells the model to multi-select with `click` plus `shift` or `cmd` on each later click, and not to hold a modifier across calls. [Experimental Computer Use](2026-09-13-experimental-computer-use.md) still owns the plugin. [Computer Use macOS HID](../bug-fix/2026-09-13-computer-use-macos-hid.md) owns the JXA posting.

## Alternatives considered

**Hold and release tools.** The model can forget to release. Abort, timeout, or a killed osascript after keyDown leaves the modifier stuck on the unsandboxed desktop. Overlay cloak is per call, so a held key outlives click-through.

**Modifiers on `drag` in this cut.** Option-drag copy is real, but the reported gap is multi-select click.

**Same-call multi-position click.** Later points go stale when the first click scrolls or reflows. Sequential click-with-modifiers keeps a screenshot per click.

## Consequences

Apps that only show extra chrome while a modifier stays down across observations still cannot be driven that way. A modified click that fails after keyDown can still stick until a matching keyUp, for the duration of that one osascript, matching `hotkey`.

## Testing

Package tests pin the allowlist, aliases, letter/`fn` rejection with no fake HID, result text, omitted/`[]` plain click, policy sentence, and generated JXA `clickWithModifiers` with flagged mouse events then keyUp. Headless snapshot sidecars pin the `click` schema and the policy sentence.
