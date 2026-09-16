---
description: "可选的实验性 GUI 工具，让视觉模型点击、输入、滚动、拖拽、长按、列出并打开应用、打开文件与浏览器，并热键操作宿主桌面，并在首次用户回合与每次动作后附上最前窗口截图。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-computer-use

[English](README.md) | 中文

## 概述

让具备视觉能力的 agent 看到宿主最前的应用窗口，并提供十三个互斥 GUI 工具，以便点击、输入、滚动、拖拽、长按、列出并打开应用、打开文件与浏览器、按热键、等待，以及把截图存到桌面和剪贴板，然后在同一次工具结果中看到新窗口。仅在你确实需要这种未沙箱化的控制时挂载。纯文本路由会跳过首张截图并拒绝这些工具。生产后端是 macOS；其他宿主仍会加载插件，并在执行时失败。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当你希望有一个操作真实桌面的专用 Computer Use agent 时，把这个私有 overlay patch 到正在运行的 Web 组合上。overlay 会追加一个系统 agent preset；GUI 工具注册在该 preset 的作用域里，而不是 Host 上。安装或 patch 就是同意门槛：这些工具不会在每次点击时询问。

### 何时选择

当视觉模型需要驱动 bash 无法到达的可见 GUI，并且你希望工具目录仅含 Shell、网页检索与抓取、十三个 GUI 工具、`code_agent` 和 `ask_user_question` 时，选择它。普通编码会话、纯文本路由，以及不得授予屏幕录制、辅助功能与访达自动化权限的宿主，都不要选择。它不是 Skill，不是能力 seam，也不属于 `dsh-base`。Desktop macOS 也会把该 overlay 作为签名 runtime extra 挂上，以便悬浮球锁死 Computer Use 会话。

### 最小配置

`pnpm dsh` 已经走 tsx，因此 patch 源码 overlay 并重启正在运行的 `dsh web`。locator 插件的相对路径入口锚定在 patch 文件上，与 Inspector 的试用路径相同，因此 CLI 应用并不依赖这个实验包：

```text
pnpm dsh web --patch packages/experimental/tool-computer-use/cordis.source.patch.yml
```

新建会话，并在模式选择器中选择 Computer Use。已有会话保持其 preset。部署默认仍是 `standard`，该模式不会收到 GUI 工具。

`pnpm run build` 之后，[`cordis.patch.yml`](cordis.patch.yml) 以同样方式加载发出的 `./lib/preset-root.js` locator。

能够解析该包名的自定义 Loader 组合也可以改为挂载：

```yaml
- id: tool-computer-use
  name: '@deepseek-ai/dsh-experimental-tool-computer-use'
  config:
    postActionWaitMs: 600
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `postActionWaitMs` | `600` | inspect 之后、截取像素之前等待的毫秒数 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-tool-computer-use)是每个受支持字段及其 JSDoc 的穷尽式真源。

在 macOS 上，截屏需要屏幕录制权限，发送点击与按键需要辅助功能权限，Finder 当前文件夹查询需要访达的自动化权限。缺少屏幕录制或辅助功能时，捕获或输入会失败，并在消息中指出对应的 TCC 权限。Windows 与 Linux 仍会加载；随后每个后端方法都会抛出 `computer-use: desktop control is implemented only on macOS`。

### 工具

没有 `observe` 工具。首次用户回合已经包含当前最前窗口，每个 GUI 工具都会在工具结果中以原生图片块返回动作后的窗口。`screenshot` 是导出：把该栅格写到用户桌面，并复制到剪贴板。图像含该窗口上打开的菜单和弹出层。不含 Dock、菜单栏、其他应用或其他显示器。

| 工具 | 参数 | 动作之后 |
|---|---|---|
| `click` | `screen_index`（0）、`position: [x,y]`（0–1000）、可选 `button`（`left`/`right`）、可选 `count`（1 或 2） | 点击、等待、重新截屏 |
| `input_text` | `screen_index`、`position`、`text`、可选 `replace`、可选 `submit` | 点击聚焦、输入、可选 Enter、等待、重新截屏 |
| `scroll` | `screen_index`、`position`、`direction`（`up`/`down`）、`scroll_level` 1–10 | 滚动、等待、重新截屏 |
| `hotkey` | `keys: string[]` | 组合键；系统截屏快捷键会被拒绝；等待、重新截屏 |
| `wait` | 无 | 暂停 1 秒、重新截屏 |
| `long_wait` | 必填 `wait_seconds`：10、30、60 或 120 | 暂停、重新截屏 |
| `screenshot` | 无 | 保存到桌面、复制该窗口到剪贴板、返回该窗口 |
| `long_press` | `screen_index`、`position`、可选 `duration_seconds` 1–10（默认 3） | 左键按住、等待、重新截屏 |
| `drag` | `start_screen_index`、`start_position`、`end_screen_index`、`end_position` | 在附加窗口上拖拽、等待、重新截屏 |
| `open_in_browser` | 可选 `url`（http(s)；省略则启动默认浏览器） | `/usr/bin/open`、等待、重新截屏 |
| `open_in_finder` | 可选 `path`（省略=桌面）、可选 `reveal_only` | Finder 或默认应用、等待、重新截屏 |
| `list_apps` | 无 | 列出正在运行的常规应用、重新截屏 |
| `open_app` | `name`（显示名或 bundle id） | 激活或启动、等待、重新截屏 |
| `code_agent` | `task`、可选 `session_id`、可选 `cwd` | 在一等 standard 会话上入队并返回该 `session_id`；两边都空闲后跟一条插件通知 |

十三个 GUI 工具都互斥运行。`presentCall` 为 generic。每次观察先给出 `<frontmost_app>`（窗口有标题时还有 `<frontmost_window>`；前台是 Finder/访达时还有 `<frontmost_folder>`；跳过 overlay 后没有剩余窗口时是 `<focus_note>`）。随后可选的屏幕信封标明序号 0 和该窗口的 0–1000 坐标空间。信封不含像素尺寸、缩放倍率或截图文件路径。没有可操作窗口时，观察只有这些标签——不附整桌面全景。

测试通过 `applyComputerUse(ctx, backend, config)` 注入假桌面，而不是 Config 上的 `driver` 钩子。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释插件背后的设计并指出实现代码；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

这个实验包有意保持为单个包。现有 agent-loop 已经会把包含图片的工具结果送入下一次模型请求，因此 Computer Use 不增加 observe 工具，也不改变 loop 语义。接地文案是 `systemPrompt.section`，不是 Skill。第二个后端才值得把 Service Definition 与 Provider 拆开；本轮把 macOS 捕获/输入与工具放在同一包中。

首帧附件使用 `agent/pre-step`：监听器始终 `await next()`，然后在已领取批次包含 `source.kind === 'user'` 消息且路由声明图片输入时，追加 `form: 'notice'` 的插件 `user` 通知，除非该用户文本以 `Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.` 开头。`agent.inject()` 只会落在下一步。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：宿主平台后端上的 `name` / `inject` / `Config` / `apply` |
| [`src/preset-root.ts`](src/preset-root.ts) | 仅 overlay 使用的插件：发布额外的 agent-presets 根目录 |
| [`src/plugin.ts`](src/plugin.ts) | 共享的 `applyComputerUse`：策略、十三个 GUI 工具、首帧 pre-step |
| [`src/selection-turn.ts`](src/selection-turn.ts) | 识别 Desktop 划词用户轮次，从而省略首帧捕获 |
| [`src/observe.ts`](src/observe.ts) | 最前窗口捕获、跳过 overlay 的前台检查，以及面向模型的信封 |
| [`src/code-agent.ts`](src/code-agent.ts) | 仅 Computer Use 的 `code_agent`：`session.create` / `session.prompt` |
| [`src/code-agent-completion.ts`](src/code-agent-completion.ts) | Code 会话与 Computer Use 调用方都空闲后投递的插件通知 |
| [`src/macos.ts`](src/macos.ts) | Darwin 通过 `screencapture -l -o` 捕获，或在设置了 overlay 窗口 id 时走 ScreenCaptureKit `--window=`；打开的菜单走 helper `--region=` 或整屏 `screencapture` 加 `sips` 裁切；click、scroll、hotkey、长按与拖拽走 JXA `CGEvent`；`input_text` 通过 NSPasteboard 粘贴；`list_apps` / `open_app` 走 NSWorkspace；`open_in_browser` / `open_in_finder` 走 `/usr/bin/open`；`inspectForeground` 绑定 `CGWindowListCopyWindowInfo` 再 unwrap（跳过 overlay id）加 Finder AppleScript |
| [`src/macos-sck-capture.swift`](src/macos-sck-capture.swift) | Darwin helper：窗口捕获或排除 overlay 后的区域裁切，仍省略 overlay CGWindowID；先在主 actor 启动 `NSApplication` |
| [`src/open.ts`](src/open.ts) | `long_press` 时长、`open_in_browser` URL 与 `open_in_finder` 路径校验 |
| [`src/wait-args.ts`](src/wait-args.ts) | 固定 1 秒的 `wait` 与 `long_wait` 的 10/30/60/120 分档 |
| [`src/screenshot.ts`](src/screenshot.ts) | `screenshot` 的桌面文件名与唯一路径写入 |
| [`src/overlay-guard.ts`](src/overlay-guard.ts) | 可选的 Desktop overlay 遮蔽：把 listScreens、capture、inspect、HID 与 `open_app` 包进 `wrapDesktopBackend`；`list_apps` / `open_in_browser` / `open_in_finder` / `copyImageToClipboard` 不包 |
| [`presets/computer-use/`](presets/computer-use/) | Computer Use agent preset：Shell、网页、GUI 工具、`code_agent`、`ask_user_question`、压缩 |
| — | 不发布运行时不变式伴生入口，因为本插件不引入新的会话事件；观察结果走现有的 `user/message` 与 `tool/result`。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [实验组](../README.zh.md) — 私有原型与公开的 Agent Teams 例外。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-computer-use) — 十三个 GUI schema 与 `code_agent`。
- [添加工具](../../../docs/cookbook/adding-a-tool.zh.md) — UI 呈现意图（`generic`）与内容中的图片块。
- [Computer Use Agent Note](../../../.agents/notes/implemented/feature/2026-09-13-experimental-computer-use.zh.md) — 插件 vs Skill vs loop、Computer Use agent preset、结果内观察，以及同意门槛。
- [Computer Use 指针与打开工具](../../../.agents/notes/implemented/feature/2026-09-15-computer-use-pointer-and-open-tools.zh.md) — `long_press`、`drag`、`open_in_browser`、`open_in_finder`、overlay-guard 分流，以及路径/URL 拒绝。
- [Computer Use 的 wait 与 long_wait](../../../.agents/notes/implemented/feature/2026-09-15-computer-use-wait-and-long-wait.zh.md) — 固定 1 秒的 `wait`、`long_wait` 分档，以及为何 10 秒下限不是 Config。
- [Computer Use 截图导出](../../../.agents/notes/implemented/feature/2026-09-15-computer-use-screenshot.zh.md) — 桌面文件加剪贴板，不是 observe 工具。
- [Computer Use 把 Code agent 完成通知停到空闲再投递](../../../.agents/notes/implemented/feature/2026-09-15-computer-use-code-agent-completion.zh.md) — 两边都空闲后投递的插件通知。
- [Computer Use 观察前台元数据](../../../.agents/notes/implemented/feature/2026-09-15-computer-use-observation-foreground.zh.md) — overlay 窗口排除、Finder 文件夹，以及现有 `user/message` / `tool/result` 上的焦点 fallback。
- [Computer Use 焦点窗口观察](../../../.agents/notes/implemented/feature/2026-09-16-computer-use-focused-window-observation.zh.md) — 跳过 overlay 后的最前窗口、`list_apps` / `open_app`，以及不附整桌面全景。
- [Computer Use 瞬时窗口观察](../../../.agents/notes/implemented/feature/2026-09-16-computer-use-transient-window-observation.zh.md) — 把打开的菜单和弹出层并进该截图。
- [Computer Use 0–1000 比例坐标](../../../.agents/notes/implemented/bug-fix/2026-09-15-computer-use-fraction-coordinates.zh.md) — 模型侧 0–1000 是可见截图上的比例，不是捕获像素。
- [图片句柄省略请求预览像素](../../../.agents/notes/implemented/bug-fix/2026-09-15-omit-request-preview-handle-dimensions.zh.md) — 共用图片句柄只写身份，不写请求预览宽高。
- [桌面悬浮球](../../../.agents/notes/implemented/feature/2026-09-14-desktop-floating-orb.zh.md) — macOS overlay、runtime extra，以及一等 `code_agent` 会话。
- [桌面 overlay-guard](../../../.agents/notes/implemented/architecture/2026-09-14-desktop-overlay-guard.zh.md) — 悬浮球的截屏排除与 HID 点击穿透。
- [Headless computer-use snapshot](../../../snapshots/session/computer-use/snapshot.yml) — 在假桌面与视觉模型上人工编写的点击循环。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

插件挂载期间，每次请求都会组装一段稳定的 `tool:computer-use` 分节。下面的文本就是完整策略。

##### Computer Use policy

```markdown
Computer Use lets you see the current frontmost application window and operate the GUI.

See: trust only the attached frontmost-window screenshot for windows, buttons, and on-screen text. The image includes open menus and popovers of that window. It does not include the Dock, menu bar, other applications, or other displays. Do not assume UI that is not visible in the latest image. You may use observation tags <frontmost_app>, <frontmost_window>, <frontmost_folder>, and <focus_note> as OS metadata.

Coordinates: the attached screenshot uses a 0–1000 space of that window. [0, 0] is the top-left of that image and [1000, 1000] is the bottom-right. x and y scale independently; do not treat the space as a square overlay. Pass position as [x, y] in that space together with screen_index 0. Map the target as a fraction of the screenshot you see. Ignore pixel widths and any other image-handle dimensions. Do not send raw pixel coordinates.

Step: take exactly one GUI action per tool call. After the call, the new screenshot is in the tool result; use that image for the next action.

Do not click or type into a target you cannot see. Do not OCR file paths from the screenshot. When a file or folder path is known, call open_in_finder with that path; do not click Desktop icons to open it. When <frontmost_folder> is present, copy that path; otherwise use bash with real paths. When <focus_note> is present, call open_app to bring the target application forward if the next step needs a window. Do not click chrome that is not in the image.

If <frontmost_app> or the screenshot is not the application the user asked for, call list_apps or open_app. Do not click the Dock; it is not in the screenshot.

Observation is not a tool. Do not call screenshot merely to see the window — the first user turn and every GUI result already attach the frontmost window. Call screenshot when the user asked for a screenshot file or needs the image on the clipboard to paste.

This session drives the real unsandboxed desktop. Use bash only for short commands inside a GUI loop. Do not use bash to write long reports or a whole project — send that work to code_agent. Do not use bash open as a substitute for open_in_finder, open_in_browser, or open_app.

Open a site in the user's visible browser with open_in_browser. web_search and web_fetch return text to you; they do not open a window the user can see.

Drag sliders, window edges, and files with drag. Press and hold with long_press.

When the latest screenshot still shows a loader, spinner, or a control that has not appeared, call wait. After click or open, the tool result already has a new screenshot; do not immediately wait unless that image still shows loading. When the screenshot shows a long job still running (download, install, export, or in-window generation), call long_wait with the smallest of 10, 30, 60, or 120 that covers remaining progress. Do not use long_wait for ordinary page load.

Route the user's request yourself:
- Visible GUI such as opening WeChat or clicking a button in Pages → GUI tools only. Do not call code_agent.
- New background work such as writing a Word document → code_agent without session_id.
- Follow-up on the same artifact such as making that Word document's font green → code_agent with the session_id from that earlier result.
- Unrelated new background work such as making a gobang game after the Word document → code_agent without session_id. Do not reuse the Word session.

After code_agent returns, tell the user the background Code agent is running, then end the turn. Do not call wait, long_wait, or bash sleep to poll that session.

When a plugin notice reports that a Code agent session finished, tell the user which background task completed and what it produced.

When a user message starts with "Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.", answer in this chat only. Do not call GUI tools, code_agent, or screenshot on that turn.
```

#### Token 影响

插件挂载期间，每次请求都有固定的策略成本。首帧屏幕与每次 GUI 工具结果都会增加图片 token，直到压缩。

#### KV Cache 影响

策略文本与工具 schema 不变时前缀稳定。首帧通知与工具结果图片追加在可复用请求前缀之后。插件 HMR 会替换该分节与 schema。

### 工具 schema

#### 模型看到什么

模型看到生成的 [`click`、`input_text`、`scroll`、`hotkey`、`wait`、`long_wait`、`screenshot`、`long_press`、`drag`、`open_in_browser`、`open_in_finder`、`list_apps`、`open_app` 与 `code_agent` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-computer-use)。没有 observe 工具。纯文本路由仍会收到 GUI schema，并在执行时被拒绝。`code_agent` 只注册在 Computer Use preset 中。

#### Token 影响

该工具视图中每次请求都有固定的 schema 成本。

#### KV Cache 影响

十四个定义及其顺序不变时前缀稳定。注册生命周期可能从第一个变化的 schema token 起使复用失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是当前的包约束。该插件驱动真实的未沙箱化桌面。

- **仅 macOS** — 捕获与 HID 输入在 Darwin 上实现；其他平台在执行时抛错。
- **屏幕录制、辅助功能与自动化 TCC** — 捕获需要屏幕录制；点击、输入、滚动、热键、长按与拖拽需要辅助功能；Finder 当前文件夹查询需要访达的自动化权限。插件不会提示授予这些权限。
- **没有逐次点击批准** — 安装或 patch 插件就是同意门槛；视觉循环不能在每个动作上询问。
- **宿主 chrome 不是最前窗口时不会进图** — Web 窗口只在它是最前窗口时出现。Desktop 主窗口在 overlay 跳过后仍可被截到。macOS overlay 由 ScreenCaptureKit 的 exclude id 校验从 Computer Use 截图中省略（窗口 filter，或菜单打开时的 display exclude 加裁切），并在 HID 突发和 `open_app` 期间通过带确认的 overlay-guard IPC 点击穿透。前台检查与 `listScreens` 都跳过这些 overlay 窗口 id，因此主窗口可以出现在 `<frontmost_app>` 里。
- **输入会使用字符串剪贴板** — `input_text` 通过 Cmd+V 粘贴，并在之后恢复先前的字符串剪贴板。其他剪贴板类型不会被恢复。`screenshot` 会用捕获的图片替换剪贴板，不恢复先前内容。
- **Retina 与附件尺寸** — backing scale 与请求栅格可能和捕获栅格不同；对可见截图使用 0–1000 比例坐标。
- **固定等待** — 动作后延迟是截取像素之前的 `postActionWaitMs`；没有像素差 stall。
- **没有套索或 `manage_files`** — GUI 覆盖是 click、type、scroll、hotkey、wait、long_wait、screenshot、长按、拖拽、open-in-browser、open-in-finder、list-apps 与 open-app。切换应用用 `open_app`，不要去点 Dock。后台文档与代码走 `code_agent`。
- **`code_agent` 通知需要活的 Agent** — execute 仍在入队接受后返回。找不到活的 Code agent、Computer Use 调用方已销毁、或 Code 会话再也不回到空闲，都会丢掉通知。策略拦不住仍然调用 `wait` 或 `long_wait` 的模型。
- **桌面 overlay 仅 macOS** — Windows Desktop 仍是单主窗口。实验包是签名 runtime extra，不是 Desktop Host 的 npm 依赖。
- **实验性原型，不提供稳定性承诺** — 本包为私有；schema 与后端可以自由变更。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
