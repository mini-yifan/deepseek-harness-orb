# Use the Desktop app

English | [中文](desktop.zh.md)

The Desktop app opens an Electron main window on one Desktop Host, and on macOS it also opens a floating ball. The main window reuses the Web UI and creates standard sessions by default. The ball locks Computer Use and delegates background coding into standard sessions that appear in the sidebar.

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

New sessions in the main window default to standard, and the mode picker stays available. Coding, file edits, and commands follow the same path as the browser Web UI. Background sessions the ball delegates also appear in the sidebar, where you can open them, continue chatting, and stop them. The ball’s own Computer Use session does not appear in the sidebar.

Closing the main window does not quit the app. The Dock icon stays after the ball appears. Quit from the Dock, with Cmd+Q, or from the ball’s right-click **Quit DeepSeek Harness**. The Dock icon or the ball’s right-click **Open Main Window** opens the main window again.

## Use the macOS floating ball

The ball is created only after Host ready. Drag it to a screen edge to dock. Click to expand the panel, and click again to collapse it. The panel has only a transcript, an input, and Stop; there is no mode picker, voice, selection toolbar, or lasso.

The input placeholder is “Ask the desktop agent…”. Sends go to the Computer Use session with a vision model. Stop cancels only that Computer Use session, not sidebar standard sessions. The context menu offers **Open Main Window** and **Quit DeepSeek Harness**; only an explicit Quit ends the process.

## How the ball routes background work

The Computer Use agent on the ball decides how to handle the current sentence. There is no extra runtime classifier:

- Visible GUI (open WeChat, click a button in Pages) uses only click / input_text / scroll / hotkey / wait and does not call the background agent.
- A follow-up on the same artifact (after writing a Word document, make the font green) sends another message on that existing standard session.
- Unrelated new background work (after the Word document, make a gobang game) creates a blank standard session.

Those background sessions are the same kind as a session you type in the main window. Files and the terminal stay with that standard agent’s bash/fs. The ball’s own bash is only for short commands inside a GUI loop.

## Limits

The floating ball is macOS-only. There is no voice, selection toolbar, lasso, drag, or per-click approval. Electron `contentProtection` hides Desktop chrome from captures; ScreenCaptureKit window exclusion is absent. The Computer Use package is a signed runtime extra, not a Desktop Host npm dependency.

## Continue

- [Desktop README](../../../apps/desktop/README.md) — development variables, packaging, and updates
- [Computer Use](../../../packages/experimental/tool-computer-use/README.md) — GUI tools and permissions
- [Configure models](./providers.md)
