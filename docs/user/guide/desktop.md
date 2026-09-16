# Use the Desktop app

English | [中文](desktop.zh.md)

The Desktop app opens an Electron main window on one Desktop Host, and on macOS it also opens a floating ball. The main window reuses the Web UI and creates standard sessions by default. The ball locks Computer Use; its chats and delegated coding sessions appear under the `dsh_orb` sidebar folder.

## Before you start

Install dependencies from the repository root. You need Node.js `^22.19 || >=24` and the pinned pnpm `11.7.0`:

```sh
pnpm install
```

Model calls need a [DeepSeek API key](https://platform.deepseek.com/). The floating ball is created only on macOS; Windows still has a single main window. Computer Use capture needs Screen Recording, and clicks and typing need Accessibility; the app does not prompt for those rights.

## Launch from source

From the repository root:

```sh
pnpm run dev:desktop
```

That command builds the Host, client, Web frontend, and Electron shell, projects a disposable development project, and launches unpackaged Electron. After an explicit build, skip the build with:

```sh
pnpm run start:desktop
```

When launch succeeds, the main window first shows “Starting DeepSeek Harness…”, then loads the Web UI after Host ready. macOS also shows an always-on-top circular ball. Development mode writes Harness home to `apps/desktop/.desktop-build/development/home` and does not change the `$DSH_HOME` your CLI uses. `export DEEPSEEK_API_KEY=…` before launch reaches the Host; you can also save the key in the main window after it opens.

## Configure a key and a workspace

The main window matches the [Web UI](./index.md): open **Settings → Models**, enter the key, and save. Click **Choose workspace** and add the project directory you want to operate. The session composer stays unavailable until a workspace is selected.

## Use the main window

New sessions in the main window default to standard, and the mode picker stays available. Coding, file edits, and commands follow the same path as the browser Web UI. Background sessions the ball delegates also appear in the sidebar under `dsh_orb`, where you can open them, continue chatting, and stop them. The main window keeps its current session when the ball starts or switches Computer Use chats.

Closing the main window does not quit the app. The Dock icon stays after the ball appears. Quit from the Dock, with Cmd+Q, or from the ball’s right-click **Quit DeepSeek Harness**. The Dock icon or the ball’s right-click **Open Main Window** opens the main window again.

## Use the macOS floating ball

The ball is created only after Host ready. Hover it to expand a white panel; the ball stays in the input corner. Click the ball to pin the panel; click again to unpin, then move away to collapse. Drag moves the ball and keeps it on screen; it does not snap to an edge. The panel shows chat bubbles, a single-line input that sends on Enter, Stop at the opposite end of the input pill from the ball only while that Computer Use session is running, **History** at the top-left to list and reopen Computer Use chats on `dsh_orb`, and **New** at the top-right for another Computer Use chat on that folder. When the Computer Use agent asks a question, the expanded panel shows the prompt with choices or a text field so you can answer on the ball; the main window can still answer the same request. There is no Send button, mode picker, voice, or lasso.

After a drag-select in another app, a toolbar offers **Search** (Bing in the default browser), **Translate** (Chinese or English into the ball’s current Computer Use chat), and **Agent Explain** (same chat, no first-frame screenshot). Right-click the ball to turn the toolbar off. The Mac must allow Accessibility; the first failed read opens System Settings.

The input placeholder is “Ask the desktop agent…”. Sends go to the Computer Use session with DeepSeek-V41-Flash at Max thinking. Stop cancels only that Computer Use session, not sidebar standard sessions. The context menu offers **Open Main Window**, enable or disable the selection toolbar, and **Quit DeepSeek Harness**; only an explicit Quit ends the process.

The ball’s Computer Use bash and filesystem default to Full access, so they can write outside `dsh_orb`. Background `code_agent` sessions keep Workspace Write.

## How the ball routes background work

The Computer Use agent on the ball decides how to handle the current sentence. There is no extra runtime classifier:

- Visible GUI (open WeChat, click a button in Pages) uses GUI tools (click, input_text, scroll, hotkey, wait, long_wait, screenshot, long_press, drag, open_in_browser, open_in_finder) and does not call the background agent.
- Asking for a screenshot file uses screenshot: it writes the capture onto Desktop and copies it to the clipboard.
- A follow-up on the same artifact (after writing a Word document, make the font green) sends another message on that existing standard session.
- Unrelated new background work (after the Word document, make a gobang game) creates a blank standard session.

After enqueue, the Computer Use agent tells you the background session is running and ends its turn, so you can keep chatting or give it new GUI work. When that standard session finishes and the ball is idle, Computer Use reports what the background agent produced.

Those background sessions are the same kind as a session you type in the main window. Files and the terminal stay with that standard agent’s bash/fs. The ball’s own bash is only for short commands inside a GUI loop.

## Limits

The floating ball is macOS-only. There is no voice, lasso, or per-click approval. Computer Use capture omits the ball, expanded panel, and selection toolbar from that screenshot via ScreenCaptureKit window exclusion, and HID makes that whole overlay click-through only for that input burst while hiding the toolbar; the main window stays capturable and hittable. The Computer Use package is a signed runtime extra, not a Desktop Host npm dependency.

## Continue

- [Desktop README](../../../apps/desktop/README.md) — development variables, packaging, and updates
- [Computer Use](../../../packages/experimental/tool-computer-use/README.md) — GUI tools and permissions
- [Configure models](./providers.md)
