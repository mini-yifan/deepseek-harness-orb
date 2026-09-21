# Use the Desktop app

English | [中文](desktop.zh.md)

The packaged Mac application is DeepSeek Orb. It opens an Electron main window on one Desktop Host, and on macOS it also opens a floating ball. The main window reuses the Web UI and creates standard sessions by default. The ball locks Computer Use; its chats and delegated coding sessions appear under the `dsh_orb` sidebar folder.

## Before you start

Install dependencies from the repository root. You need Node.js `^22.19 || >=24` and the pinned pnpm `11.7.0`:

```sh
pnpm install
```

Model calls need a [DeepSeek API key](https://platform.deepseek.com/). The floating ball is created only on macOS; Windows still has a single main window. Computer Use needs Screen Recording and Accessibility: the first overlay expand covers the panel with those two rows, each button opens that System Settings pane, and the cover disappears when both rights are granted to this process. Overlay send stays in the composer until then. Finder Automation prompts on first use.

## Launch from source

From the repository root:

```sh
pnpm run dev:desktop
```

That command builds the Host, client, Web frontend, and Electron shell, projects a disposable development project, and launches unpackaged Electron. After an explicit build, skip the build with:

```sh
pnpm run start:desktop
```

When launch succeeds, the main window first shows “Starting DeepSeek Orb…”, then loads the Web UI after Host ready. macOS also shows an always-on-top circular ball. Development mode writes Harness home to `apps/desktop/.desktop-build/development/home` and does not change the `$DSH_HOME` your CLI uses. `export DEEPSEEK_API_KEY=…` before launch reaches the Host; you can also save the key in the main window after it opens.

## Configure a key and a workspace

The main window matches the [Web UI](./index.md): open **Settings → Models**, enter the key, and save. Click **Choose workspace** and add the project directory you want to operate. The session composer stays unavailable until a workspace is selected.

## Use the main window

New sessions in the main window default to standard, and the mode picker stays available. Coding, file edits, and commands follow the same path as the browser Web UI. Background sessions the ball delegates also appear in the sidebar under `dsh_orb`, where you can open them, continue chatting, and stop them. The main window keeps its current session when the ball starts or switches Computer Use chats.

Closing the main window does not quit the app. The Dock icon stays after the ball appears. Quit from the Dock, with Cmd+Q, or from the ball’s right-click **Quit DeepSeek Orb**. The Dock icon or the ball’s right-click **Open Main Window** opens the main window again.

## Use the macOS floating ball

The ball is created only after Host ready, on the primary display’s right edge a little below vertical center. Hover it to expand a panel that follows the main window Appearance; the ball stays in the input corner. Click the ball to pin the panel; click again to unpin, then move away to collapse. Drag moves the ball; releasing after about one-fifth of it sits past the left or right screen edge slides it off into a thin gray tab, and after a short pause a hover slides the full ball back. The panel shows Compact Chat (the same transcript as the main window), a wrapping input that grows around the ball (Enter sends, Shift+Enter inserts a newline), Stop at the opposite end of the input pill from the ball only while that Computer Use session is running, **History** at the top-left to list and reopen Computer Use chats on `dsh_orb`, an **Access** chip between History and New (Read Only, Workspace Write, or Full access; no Full access confirmation), and **New** at the top-right for another Computer Use chat on that folder. When the Computer Use agent asks a question, the expanded panel shows the prompt with choices or a text field so you can answer on the ball; Compact Chat stays visible above the input, and the main window can still answer the same request. There is no Send button, mode picker, voice, or lasso.

After a drag-select in another app, a toolbar offers **Search** (Bing in the default browser), **Translate** (Chinese or English into the ball’s current Computer Use chat, no first-frame screenshot), and **Send to Agent** (attaches the quote as a one-line chip on the overlay composer; Enter sends your instruction plus the full quote as a normal Computer Use turn with a first-frame screenshot). New and other overlay buttons keep the chip until that first Enter or the chip’s dismiss control. Any key, a click outside those three actions, a right-click, a middle-click, or a scroll dismisses the toolbar. Right-click the ball to turn the toolbar off. The Mac must allow Accessibility; the first failed read opens System Settings.

The input placeholder is “Ask the desktop agent…”. Sends go to the Computer Use session. The ball defaults to DeepSeek-V41-Flash at Max thinking until you change **Floating Agent Settings** or Settings → **Floating ball**; that choice does not change the main window’s New Chat model. Stop cancels only that Computer Use session, not sidebar standard sessions. Right-click the ball for **Open Main Window**, **Floating Agent Settings** and **Background Agent Settings** (independent model and reasoning effort; background apply is for new `code_agent` sessions only), enable or disable the selection toolbar, enable or disable millifraction coordinates (confirming creates a new overlay chat; the open chat keeps its encoding), and **Quit DeepSeek Orb**; only an explicit Quit ends the process. Settings → **Floating ball** also sets a custom GIF, PNG, or WebP ball image (2 MB cap), restore-to-default, millifraction coordinates for new overlay chats, and macOS Screen Recording / Accessibility status; Access, Open Main Window, and Quit stay on the right-click menu.

The ball’s Computer Use bash and filesystem, and new background `code_agent` sessions on `dsh_orb` or a subdirectory of it, follow the Access chip on the ball (default Full access, stored as a Desktop preference). A background session on a named folder outside that tree stays ordinary Workspace Write; that agent also answers its own approval and ask-user prompts. Changing Access in the main window applies while you keep chatting there; sending from the ball writes the chip on the ball back onto that agent.

## How the ball routes background work

The Computer Use agent on the ball decides how to handle the current sentence. There is no extra runtime classifier:

- Visible GUI (open WeChat, click a button in Pages) uses GUI tools (click, input_text, scroll, hotkey, wait, long_wait, screenshot, long_press, drag, open_in_browser, open_in_finder) and does not call the background agent.
- Short lookup (today's weather, current headlines) uses web_search or web_fetch in the ball chat. It does not start a background agent or click around the GUI.
- Long work (Word, PPT, Excel, a website, or a research report written as HTML) starts a background Code agent. The ball tells you it is running and ends the turn.
- Asking for a screenshot file uses screenshot: it writes the capture onto Desktop and copies it to the clipboard.
- A follow-up on the same artifact (after writing a Word document, make the font green) sends another message on that existing standard session, even if it is still running.
- Unrelated new background work (after the Word document, make a gobang game) creates another standard session.

When you name a folder (Desktop, a home path), that background session uses it. When you say here / this folder / the current window and Finder is frontmost, it uses that Finder folder. When you say those words and Finder is not frontmost, the ball asks you to click that Finder window or give a path. Otherwise it creates a new subdirectory under `dsh_orb`. If you name a folder or window that does not match what the ball sees, it asks instead of guessing.

Ask the ball what is running, and it lists only the background agents this Computer Use chat started (count, latest task, folder, running or idle). New chat starts with an empty list. Ask it to stop one, and that session's current turn and queued follow-ups die; the session stays so you can continue the same artifact later. Overlay Stop still cancels only Computer Use.

After enqueue, the Computer Use agent tells you the background session is running and ends its turn, so you can keep chatting or give it new GUI work. When that standard session finishes and the ball is idle, Computer Use reports what the background agent produced.

Those background sessions are the same kind as a session you type in the main window. Files and the terminal stay with that standard agent’s bash/fs. The ball’s own bash is only for short commands inside a GUI loop.

## Limits

The floating ball is macOS-only. Windows still lists **Floating ball** in Settings with every control disabled. There is no voice, lasso, or per-click approval. Computer Use capture omits the ball, expanded panel, selection toolbar, and observation-frame ribbon from that screenshot via ScreenCaptureKit window exclusion, and HID makes that whole overlay click-through only for that input burst while hiding the toolbar; the main window stays capturable and hittable. The Computer Use package is a signed runtime extra, not a Desktop Host npm dependency.

## Continue

- [Desktop README](../../../apps/desktop/README.md) — development variables, packaging, and updates
- [Computer Use](../../../packages/experimental/tool-computer-use/README.md) — GUI tools and permissions
- [Configure models](./providers.md)
