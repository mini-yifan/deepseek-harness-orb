<p align="center"><img src="apps/desktop/build/icon.png" width="128" alt="DeepSeek Orb app icon" /></p>

# DeepSeek Orb

English | [中文](README.zh.md)

A desktop AI agent assistant that stays on call, for macOS and Windows, built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh 0.1.7).

DeepSeek Orb is an unofficial community project and is not affiliated with DeepSeek AI.

A floating ball rests at the edge of your screen. Tell it what you need: quick, visible actions are executed directly in the current app, finished in front of you through Computer Use; long-running complex tasks are dispatched to a background coding session, and the result comes back to the ball when it finishes. The main window keeps the full dsh Web UI — session management, the plugin market, and model settings — so you can still write code, edit files, and run commands in it.

The app collects no telemetry.

## Dual-track agent architecture

The Computer Use Agent inside the floating ball decides how every message is handled; there is no separate task classifier at runtime:

```mermaid
flowchart td
    user["You speak to the floating ball"] --> orb["Computer Use Agent"]
    orb -->|"Visible GUI actions"| gui["13 GUI tools<br>executed in the current window"]
    orb -->|"Quick lookups: weather, news"| web["web_search / web_fetch<br>answered on the ball"]
    orb -->|"Dig through files, produce documents or websites"| bg["code_agent background session<br>queued, returns immediately"]
    bg -->|"Completion notice"| orb
```

- **Foreground track · Computer Use**: visible operations — opening apps, clicking buttons, filling forms, changing settings — are executed with GUI tools right in front of you, each step based on a live screenshot of the frontmost window. Quick lookups such as weather or news headlines stay on the ball too, answered directly with `web_search` / `web_fetch`.
- **Background track · Code Agent**: complex tasks — digging through files, producing Word/PPT/Excel documents, building a website — are dispatched through `code_agent` to a background standard session. Dispatch returns immediately; the ball tells you the background is running and you can keep chatting. When the background session ends and the ball is idle, the completion summary returns to the ball automatically, and the Computer Use Agent decides the next move — keep clicking, dispatch more background work, or wrap up.

A background session is the same kind of session you create manually in the main window; it appears in the `dsh_orb` folder in the main-window sidebar, where you can open, continue, or stop it. Only the ball conversation that started it can continue or stop it. Follow-up changes to the same deliverable go back to the same background session; unrelated new work opens another one. The Stop button on the floating ball only cancels the ball's Computer Use session and never affects a background session.

## The floating ball

On startup the ball rests at the right edge of the primary display, slightly below vertical center, always on top. The default model is DeepSeek-V41-Flash at Max thinking.

- **Hover** expands the panel, **click** pins it, and it collapses when the pointer leaves.
- **Drag** moves the ball; release it after dragging about a fifth of it beyond the left or right screen edge and it docks into a thin gray tab — hover again to slide it back.
- **Right-click** opens the menu: open the main window, floating-ball agent settings and background agent settings (each track picks its own model and thinking level), the selection-toolbar toggle, the coordinate-encoding toggle (pixel by default, switchable to millifraction), and quit DeepSeek Orb.
- The panel carries the same conversation history as the main window, a composer that grows around the ball (Enter sends, Shift+Enter inserts a newline), the **Access** chip (view-only / workspace edits / full access, full by default, applying to the ball's commands and the background sessions it dispatches), **History** (the ball's Computer Use conversations), and **New**. When the agent asks you a question, the question card is answered right on the ball.
- Drag-selecting text in any app pops up a toolbar: **Search** (opens Bing in your default browser), **Translate** (the result is written into the ball's current conversation), and **Send to agent** (the text sits by the input; Enter sends it together with your instruction).
- The ball avatar can be replaced with a custom GIF / PNG / WebP (2 MB cap) in main-window Settings → Floating Ball.

Closing the main window does not quit the app; only "Quit DeepSeek Orb" in the right-click menu ends the process.

## Computer Use

Every conversation on the ball runs Computer Use: the first message automatically attaches a screenshot of the frontmost app's visible windows, and another screenshot follows every action, so the model always sees the latest screen state. Screenshots automatically omit the ball, the expanded panel, the selection toolbar, and the observation border, and the overlay never blocks clicks while an operation runs. The observed window gets a glowing observation border around it, marking what the agent is looking at. Coordinates are pixel-encoded by default; switch to 0–1000 millifraction encoding in the ball's right-click menu or in main-window Settings → Floating Ball.

Tool list: `click` (single/double/right click, hold modifiers), `input_text`, `scroll`, `hotkey`, `long_press`, `drag`, `wait`, `long_wait`, `screenshot` (saved to the Desktop and copied to the clipboard), `open_in_browser`, `open_in_finder`, `list_apps`, `open_app`.

- **macOS**: the first time you expand the panel you must grant Screen Recording and Accessibility permissions; the onboarding layer opens the matching System Settings pages and disappears once both are granted. Finder automation asks for authorization on first use.
- **Windows**: no system-permission onboarding is needed; windows running as administrator refuse to be clicked or typed into.
- Read the safety notice in [SAFETY.md](SAFETY.md) before running.

## Platform support

| Platform | Floating ball and Computer Use | Installers |
|---|---|---|
| macOS (Apple Silicon / Intel) | Fully supported; Screen Recording + Accessibility permissions required | Signed DMG / ZIP; local unsigned preview build |
| Windows x64 | Fully supported; administrator windows refuse to be operated | NSIS installer (.exe); local unsigned build |
| Linux | No floating ball; the main window works, settings controls are disabled | Not a release target |

## Getting started

### Prerequisites

- Node.js `^22.19.0 || >=24.0.0`, pnpm `11.7.0`.
- A [DeepSeek API key](https://platform.deepseek.com/): save it in the main window under **Settings → Models** after startup, or `export DEEPSEEK_API_KEY=…` before starting. Keys live in `~/.dsh/.credentials.yaml`, shared with the dsh CLI.
- The main window's input is available only after a workspace is selected; the floating ball always uses its own `dsh_orb` workspace, no configuration needed.

### Run from source

```sh
git clone https://github.com/mini-yifan/deepseek-harness-orb.git
cd deepseek-harness-orb
pnpm install
pnpm run dev:desktop
```

`dev:desktop` builds the Host, clients, Web frontend, and the Electron shell, then launches the unpackaged app; once everything is built, `pnpm run start:desktop` skips the build. The main window shows a splash screen first, loads the Web UI when ready, and the floating ball appears at the screen edge.

### Local packaging

| Target | Command | Notes |
|---|---|---|
| macOS (Apple Silicon) | `pnpm run package:desktop:mac:arm64` | Signed release flow in [MAC-RELEASE-PACK.md](apps/desktop/MAC-RELEASE-PACK.md); unsigned preview build in [UNSIGNED-MAC-PACK.md](apps/desktop/UNSIGNED-MAC-PACK.md) |
| Windows x64 (unsigned) | `pnpm run package:desktop:win:x64:unsigned` | Environment variables and tool cache in [UNSIGNED-WIN-PACK.md](apps/desktop/UNSIGNED-WIN-PACK.md); SmartScreen will block it — choose "Run anyway" |

Packaging details and platform requirements: [apps/desktop/README.md](apps/desktop/README.md).

## Relationship to DeepSeek Harness

This repository is an unofficial derivative of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), built on dsh 0.1.7 and not affiliated with DeepSeek AI. The `main` branch carries the DeepSeek Orb product and merges upstream updates continuously. dsh is DeepSeek AI's open-source everything-is-a-plugin agent harness; this product's sessions, plugins, tools, and Web UI are all driven by it. To go deeper:

- [Using the desktop app](docs/user/guide/desktop.md) — the full user guide for the floating ball and background dispatch
- [Computer Use package](packages/experimental/tool-computer-use/README.md) — GUI tools, coordinate encoding, and permission details
- [apps/desktop/README.md](apps/desktop/README.md) — development variables, packaging, and updates
- [docs/architecture.md](docs/architecture.md) and [packages/README.md](packages/README.md) — the underlying harness architecture and the package map

## Known limitations

- No voice input, no screen-region screenshot selection, and no per-click approval.
- Only the floating-ball system is excluded from Computer Use screenshots; the main window can always be captured and clicked.
- Computer Use is an experimental package shipped inside the app as a built-in runtime extra, not an npm dependency of the Desktop Host.
- No floating ball on Linux; the local unsigned Windows installer is blocked by SmartScreen and must be allowed manually.

## License

[MIT](LICENSE), inherited from upstream DeepSeek Harness; third-party dependency licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
