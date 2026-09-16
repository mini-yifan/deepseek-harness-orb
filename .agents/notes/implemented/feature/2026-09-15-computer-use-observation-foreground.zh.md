# Agent Note: Computer Use 观察前台元数据

Status: implemented

[English](2026-09-15-computer-use-observation-foreground.md) | 中文

## 问题

Computer Use 观察已经会附上屏幕，但模型无法知道当前焦点在哪个应用，也无法知道 Finder 打开的是哪个文件夹。POLICY 禁止从像素里 OCR 文件路径，因此 Finder 操作没有可信路径。捕获会跳过 overlay chrome；如果检查前台时不配套跳过，文本就会把悬浮球报成前台。

## 决策

`observeDesktop` 先调用一次 `DesktopBackend.inspectForeground`，并在 `listScreens` 返回该面时捕获跳过 overlay 后的最前窗口。面向模型的内容是一块前台文本，窗口仍在时再跟窗口信封和图片。overlay 跳过使用 `activeCaptureExcludeWindowIds()`（球与展开面板共用那扇窗）。检查路径不跳过 Electron PID。若 Desktop 主窗口是 z-order 中下一个，`<frontmost_app>` 就是该窗口的本地化名称（通常是 DeepSeek Harness），并且不走 fallback。[Computer Use 焦点窗口观察](2026-09-16-computer-use-focused-window-observation.zh.md) 拥有窗口捕获、可选的 `<frontmost_window>`，以及空最前不附整桌面全景的路径。

剩余窗口所有者是 `Finder` 或 `访达` 时，第二次 osascript 把 `POSIX path of (target of front window as alias)` 读进 `<frontmost_folder>`。超时或空结果会省略文件夹标签并保留应用名。没有任何剩余窗口带所有者名称时，信封是 `<frontmost_app>none</frontmost_app>` 加上 `<focus_note>`。空标签省略。从不发出截图文件系统路径。从不编造 Finder 路径。

这些标签走现有的 `user/message`（首帧插件通知）和 `tool/result` 内容。没有新的会话事件，没有 `ignorable` 标志，也不 bump `SESSION_FORMAT_VERSION`。`SCREEN_SCHEMA` 保持不变（`additionalProperties: false`）。结构化的 `foreground` 是每个 GUI 工具输出上的兄弟字段，以便 `output.render` 能格式化它。

macOS JXA 在跳过 overlay 之后检查屏幕上 layer-0 窗口，并同时返回窗口 id、全局边框和可选标题供捕获。假后端默认 `{ appName: 'Pages' }`，因此人工编写的 snapshot 能钉住一个不含文件夹的稳定标签。不支持的后端抛出同样的仅 macOS 错误。`wrapDesktopBackend` 在 `withCapture` 里跑 inspect 和 `listScreens`，这样 exclude id 是活的；`openApp` 走 `withInput`；`listApps` 和其他 `open_*` 方法保持不包装。查询或解析失败返回焦点 fallback，且不得让 `observeDesktop` 失败。中止仍会让这次观察失败。

[实验性 Computer Use](2026-09-13-experimental-computer-use.zh.md) 仍拥有 GUI 工具、首帧附件和同意门槛。

## 考虑过的替代方案

**跳过宿主 Electron PID。** Computer Use 跑在 Desktop Host 的 Node 子进程里；overlay 和主窗口属于 Electron。按 PID 跳过会在 DeepSeek Harness 已是 overlay 之后下一个可操作目标时，仍然把它藏起来。

**CoView 式的上次外部应用跟踪。** 若 overlay 有焦点且主窗口在 Chrome 之上，只跳 overlay 会报 DeepSeek Harness。记住最近一个非 harness 应用的跟踪器留到后续裁剪。

**新的 `computer-use/foreground` 会话事件。** 观察结果已经在 `user/message` 和 `tool/result` 上对模型可见。新事件会 bump 格式机制，却没有新的可重建需求。

**把 `foreground` 放进 `SCREEN_SCHEMA`。** 前台是每次观察一条事实，不是每块显示器一条。屏幕对象禁止额外属性。

**窗口标题、Office 文档路径，或其他应用的文件夹。** 本笔记发布了应用名、Finder 文件夹和焦点 fallback。可选的 `<frontmost_window>` 由 [Computer Use 焦点窗口观察](2026-09-16-computer-use-focused-window-observation.zh.md) 拥有。

## 影响

每次观察都会多花一些 token 在 OS 元数据上。Finder 文件夹查询需要访达的自动化权限；缺少授权时省略文件夹并保留应用名。只跳 overlay 时，可以把 Desktop 主窗口报成 `<frontmost_app>`。检查失败时，若仍有最前窗口则附上它并带 fallback 标签；空最前不附全景。

## 测试

包测试用注入的 CommandRunner 覆盖 overlay id 跳过、Finder/访达文件夹、省略文件夹，以及 fallback；observe/tools 测试钉住这些标签，并且仍然不含 `<path>`；overlay-guard 测试在 `withCapture` 里跑 inspect 和 `listScreens`；loop 与 pre-step 测试要求首帧通知和 click 结果含 `<frontmost_app>`。人工编写的 [`snapshots/session/computer-use/session.v3.jsonl`](../../../../snapshots/session/computer-use/session.v3.jsonl) 把假桌面的 `Pages` 钉在首帧和 click 上；Finder 与 fallback 留在单元测试里。
