# Agent Note: Computer Use macOS HID posting

Status: implemented

English | [中文](2026-09-13-computer-use-macos-hid.zh.md)

## Problem

The experimental Computer Use macOS backend posted JXA `CGEvent` input that looked successful while the desktop did not receive a click or the requested text. The pointer moved to the mapped point, then left-button down/up either never landed or was too brief for AppKit and Electron to treat as a click. `input_text` always inserted the letter `a`. Hotkeys posted a different keyboard event than the one whose modifier flags were set. Scroll used the variadic `CGEventCreateScrollWheelEvent`, which JXA does not call reliably.

JXA exposes CoreGraphics `kCG*` enums as strings and cannot pass a `UniChar *` into `CGEventKeyboardSetUnicodeString`. JavaScript `null` is not C `NULL`. Virtual keycode `0` is the `a` key, so a keyboard event whose unicode override is ignored types `a`.

## Decision

Every HID action writes one UTF-8 JXA file and runs `/usr/bin/osascript -l JavaScript` on that file. The script keeps a `CGEventSource` in HID system state, uses numeric CGEvent types and `CGPointMake`, and sleeps between move, down, and up. A double-click is two down/up cycles with click-state 1 then 2.

`input_text` clicks to focus, optionally sends Cmd+A, pastes through `NSPasteboard` plus Cmd+V, optionally presses Enter, and restores the previous string clipboard. JXA invokes no-arg ObjC methods on property access, so pasteboard `clearContents` is not called as a JavaScript function. Hotkeys hold modifiers, set flags on the same event that is posted, then tap non-modifier keys. Scroll moves to the point, then posts `CGEventCreateScrollWheelEvent2` once per `scroll_level` line tick.

## Alternatives considered

**Keep `CGEventKeyboardSetUnicodeString` with a JavaScript string.** JXA accepts the call and still leaves keycode 0 mapped to `a`. A `UniChar` `Ref` or `NSData.bytes` pointer throws `Ref has incompatible type`.

**System Events `keystroke`.** It needs a second Automation TCC right and still fails for many non-Latin strings. Paste uses the Accessibility right already required for clicks.

**Per-character virtual keycodes.** That table cannot express CJK or emoji. Paste inserts the tool `text` as given.

**`CGEventCreateScrollWheelEvent`.** The C API is variadic. `CGEventCreateScrollWheelEvent2` is the non-variadic replacement JXA can invoke.

## Consequences

`input_text` overwrites the string clipboard for the duration of Cmd+V and restores only that string; other clipboard types are not restored. Intra-event sleeps are HID timing, not `postActionWaitMs`. Tests still inject a `CommandRunner` and never post to a real desktop.

## Testing

`packages/experimental/tool-computer-use/tests/macos.spec.ts` captures the generated JXA and asserts `clickAt` (including right-button double-click), `pasteText` / `selectAll` / `pressEnter`, pasteboard `clearContents` as a property rather than a JS call, `chord([55,8])` for Cmd+C, and `CGEventCreateScrollWheelEvent2` with signed `scrollAt` deltas. Empty `text` does not call `pasteText`. Unknown hotkeys still throw before osascript. HID subprocess failures still name Accessibility.
