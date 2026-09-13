# Agent Note: Experimental Computer Use plugin

Status: implemented

English | [中文](2026-09-13-experimental-computer-use.zh.md)

## Problem

A vision model can already consume image blocks that a tool result or user message carries, but the shipped agent-loop has no host plugin that captures the live desktop, maps a 0–1000 coordinate space onto displays, and posts GUI input. Putting that behavior in a Skill would hide it from the tool catalog. Changing `agent-loop` to special-case screenshots would make visual desktop control a loop feature instead of a composition choice. An observe/screenshot tool would spend a turn on a capture the next GUI action must repeat anyway.

## Decision

`@deepseek-ai/dsh-experimental-tool-computer-use` is a private experimental Cordis plugin. It registers five exclusive GUI tools (`click`, `input_text`, `scroll`, `hotkey`, `wait`) and attaches current screens on the first user turn through `agent/pre-step`. Each tool performs one desktop action, waits `postActionWaitMs`, recaptures, and returns `[text envelope, ...ImageBlock]` from `output.render`. Images live in content, not `presentationMeta`. There is no screenshot tool.

`applyComputerUse(ctx, backend, config)` is the shared registration helper. Production `apply` uses the host-platform backend (macOS capture and HID input; other platforms throw the fixed macOS-only error at execute). Tests and keyless snapshots inject a fake desktop that returns a fixture PNG and records actions. There is no Config `driver: fake`. macOS HID posting is owned by [Computer Use macOS HID](../bug-fix/2026-09-13-computer-use-macos-hid.md).

The plugin injects `tools`, `systemPrompt`, and `attachments`. Missing attachments keep it pending. Optional `llm` gates image-capable routes: text-only routes skip first-frame images and refuse the tools. Installing or patching the plugin is the consent gate; tools do not `ask` per click. The plugin is not in `dsh-base`. Local try is `pnpm dsh web --patch packages/experimental/tool-computer-use/cordis.source.patch.yml`.

Grounding copy is a `systemPrompt.section`. Coordinates are 0–1000 per screen. System screenshot chords (Cmd/Win+Shift+3/4/5) are rejected.

## Alternatives considered

**Skill-only grounding.** A Skill can carry See/Step copy, but it cannot register tools, attach durable images, or appear in the generated tool catalog. Computer Use is a Host plugin with a prompt section.

**Change `agent-loop`.** The loop already forwards tool-result images into the next request. A loop special case would make desktop control a core semantic and force every composition to know about screens.

**Observe/screenshot tool.** A dedicated capture tool would add a turn whose only job is an image the next GUI tool must recapture after acting. Observation belongs in the first user turn and in every GUI result.

**Per-click `ask`.** The interaction seam's `allowed-once` grant cannot keep a visual loop usable. Consent is installing or patching this experimental plugin; the README states that it drives the real unsandboxed desktop.

**Capability seam in this cut.** One package owns the macOS backend, tools, and pre-step. A second backend (Playwright / Electron) would justify splitting Service Definition from Provider.

**Windows/Linux input in this cut.** Non-macOS hosts still load so Linux CI can mount a fake backend. Production methods throw at execute.

## Consequences

Mounting the plugin on an image-capable route adds policy tokens and five exclusive schemas on every request, plus image tokens for first-frame notices and every GUI result until compaction. Text-only routes keep coding sessions working: first-frame attachment is skipped and GUI tools fail with a route diagnostic. macOS needs Screen Recording and Accessibility; missing rights fail capture or input with a named TCC message. `input_text` overwrites the string clipboard during paste and restores it afterwards. Web/Electron chrome appears in shots. There is no per-click approval, chrome exclusion, pixel-diff settle, drag, or `dsh-base` default.

## Testing

Package tests use a fake desktop only. They cover coordinate mapping, hotkey rejection, tool execute/render, first-frame pre-step, text-only refusal, HMR, Loader composition through a test-only `cordis.yml`, and an in-process agent-loop click that places image blocks on `user/message` and `tool/result`. Injected macOS `CommandRunner` tests assert generated JXA contains `clickAt`, `pasteText`, `chord`, and `CGEventCreateScrollWheelEvent2`.

The authored headless overlay [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) mounts a scenario-local fake-desktop plugin plus vision model `deepseek-v4-flash-vision-exp` with `postActionWaitMs: 0`. Replay uses a fixture PNG and never drives a real desktop. The plugin is not in shipped `dsh-base`.
