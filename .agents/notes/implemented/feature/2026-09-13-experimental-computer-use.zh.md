# Agent Note: 实验性 Computer Use 插件

Status: implemented

[English](2026-09-13-experimental-computer-use.md) | 中文

## 问题

视觉模型已经能消费工具结果或用户消息携带的图片块，但已发布的 agent-loop 没有宿主插件去捕获实时桌面、把 0–1000 坐标空间映射到显示器，并发送 GUI 输入。把该行为放进 Skill 会让它离开工具目录。为了截屏去改 `agent-loop`，会把视觉桌面控制变成 loop 特性，而不是组合选择。observe/screenshot 工具会浪费一轮，而下一次 GUI 动作本来就必须再截一次。

## 决策

`@deepseek-ai/dsh-experimental-tool-computer-use` 是私有实验性 Cordis 插件。它注册十三个互斥 GUI 工具（`click`、`input_text`、`scroll`、`hotkey`、`wait`、`long_wait`、`screenshot`、`long_press`、`drag`、`open_in_browser`、`open_in_finder`、`list_apps`、`open_app`），并通过 `agent/pre-step` 在首次用户回合附上当前最前窗口。每个工具执行一次桌面动作，在截取像素之前等待 `postActionWaitMs`，重新截屏，并由 `output.render` 返回 `[文本信封, ...ImageBlock]`。信封以 `<frontmost_app>` 开头（窗口有标题时还有 `<frontmost_window>`；前台是 Finder 时还有 `<frontmost_folder>`；跳过 overlay 窗口后没有剩余窗口时是 `<focus_note>`），捕获到窗口时还有 `<screen_index>0</screen_index>` 与该会话点击空间（默认 `<coordinate_space>0-1000</coordinate_space>`；overlay 像素会话按 [Overlay 会话上的 Computer Use 千分比与像素坐标模式](2026-09-19-computer-use-session-coordinate-modes.zh.md) 附加 WxH）；[Computer Use 观察前台元数据](2026-09-15-computer-use-observation-foreground.zh.md) 拥有这些前台标签，[Computer Use 焦点窗口观察](2026-09-16-computer-use-focused-window-observation.zh.md) 拥有所有者选取和 `list_apps` / `open_app`，[Computer Use 应用窗口观察](2026-09-16-computer-use-app-window-observation.zh.md) 拥有家族并集与始终区域捕获，[Computer Use 0–1000 比例坐标](../bug-fix/2026-09-15-computer-use-fraction-coordinates.zh.md) 拥有默认千分比点击空间。图片放在内容里，不放在 `presentationMeta`。没有 observe 工具。`screenshot` 会写入桌面文件和剪贴板；[Computer Use 截图导出](2026-09-15-computer-use-screenshot.zh.md) 拥有该导出。[Computer Use 指针与打开工具](2026-09-15-computer-use-pointer-and-open-tools.zh.md) 拥有 `long_press`、`drag`、`open_in_browser` 与 `open_in_finder`。[Computer Use 单击修饰键](2026-09-19-computer-use-click-modifiers.zh.md) 拥有仅在该次单击期间按住的可选 click 修饰键。[Computer Use 的 wait 与 long_wait](2026-09-15-computer-use-wait-and-long-wait.zh.md) 拥有两个等待工具。

`applyComputerUse(ctx, backend, config)` 是共享注册助手。生产环境的 `apply` 使用宿主平台后端（macOS 捕获与 HID 输入；其他平台在执行时抛出固定的仅 macOS 错误）。测试与无密钥 snapshot 注入返回固定 PNG 并记录动作的假桌面。没有 Config `driver: fake`。macOS HID 发送由 [Computer Use macOS HID](../bug-fix/2026-09-13-computer-use-macos-hid.zh.md) 负责。

插件注入 `tools`、`systemPrompt` 与 `attachments`。缺少 attachments 时保持 pending。可选的 `llm` 负责图片路由门禁：纯文本路由跳过首帧图片并拒绝这些工具。安装或 patch 插件就是同意门槛；工具不会对每次点击 `ask`。插件不在 `dsh-base` 中。本地试用是 `pnpm dsh web --patch packages/experimental/tool-computer-use/cordis.source.patch.yml`，然后在新会话上选择 Computer Use agent preset。Desktop 把同一包作为签名 runtime extra 拷贝，并由 Desktop Host 挂上 locator，而不是作为 npm 依赖；见 [桌面悬浮球](2026-09-14-desktop-floating-orb.zh.md)。

Web overlay 只插入 `computer-use-preset-root`，由它提供本包旁的额外 `trust: system` agent-presets 根目录。overlay 在 `agent-presets` 行上加上 `inject: [computerUsePresetRoot]`，因此 Loader 插值 `!!js ctx.computerUsePresetRoot` 会等到该服务就绪。GUI 工具注册在该 preset 的常驻作用域里。Host 目录与随附的 `standard` preset 都不会收到它们。Computer Use preset 还会注册 `code_agent`，它通过 `session.create` / `session.prompt` 创建或续写一等 standard 会话，以便桌面侧栏显示委派工作。接受之后，调用方拥有的监视会把插件通知停到两边都空闲再投递；[Computer Use 把 Code agent 完成通知停到空闲再投递](2026-09-15-computer-use-code-agent-completion.zh.md) 拥有这条投递路径。[Overlay Computer Use 后台调度](2026-09-17-orb-code-agent-dispatch.zh.md) 拥有新建 cwd、调用方登记表、`code_agent_status` / `code_agent_stop`，以及 Code agent 上的无人值守应答。

接地文案是 `systemPrompt.section`。坐标默认是可见截图上的 0–1000 比例；[Computer Use 0–1000 比例坐标](../bug-fix/2026-09-15-computer-use-fraction-coordinates.zh.md) 拥有该编码。Overlay 会话可打上像素模式；[Overlay 会话上的 Computer Use 千分比与像素坐标模式](2026-09-19-computer-use-session-coordinate-modes.zh.md) 拥有该分叉。系统截屏组合键（Cmd/Win+Shift+3/4/5）会被拒绝。Step 文案允许模型在目标已出现在最新截图上时于同一步发出多个 GUI 调用；[Computer Use 同一步 GUI 调用](2026-09-19-computer-use-same-step-gui-calls.zh.md) 拥有该政策。每次调用仍会重新截屏。

## 考虑过的替代方案

**只用 Skill 做接地。** Skill 可以携带 See/Step 文案，但不能注册工具、附加持久图片，或出现在生成的工具目录中。Computer Use 是带提示词分节的 Cordis 插件，由 Computer Use agent preset 组合。

**把 GUI 工具插到 Host。** Host 注册的工具会出现在每个 preset 中，包括 `standard`。overlay 改为追加一个系统 extra root，因此只有点名 `computer-use` 的会话才会收到十三个 GUI 工具。

**改 `agent-loop`。** loop 已经会把工具结果中的图片送入下一次请求。loop 特例会让桌面控制变成核心语义，并迫使每个组合都了解屏幕。

**Observe 工具。** 专用捕获工具会增加一轮，其唯一工作是一张图片，而下一个 GUI 工具在动作后还必须再截。观察属于首次用户回合和每次 GUI 结果。保存用户可见文件是另一件事，由 [Computer Use 截图导出](2026-09-15-computer-use-screenshot.zh.md) 拥有。

**每次点击都 `ask`。** 交互 seam 的 `allowed-once` 授权无法让视觉循环可用。同意门槛是安装或 patch 这个实验插件；README 写明它驱动真实的未沙箱化桌面。

**本轮做成能力 seam。** 一个包同时拥有 macOS 后端、工具与 pre-step。第二个后端（Playwright / Electron）才值得把 Service Definition 与 Provider 拆开。

**本轮做 Windows/Linux 输入。** 非 macOS 宿主仍会加载，以便 Linux CI 挂载假后端。生产方法在执行时抛错。

**用 `tool-subagent` 做后台编码。** `origin: 'subagent'` 会把子会话从工作区侧栏藏掉，并且 `session.prompt` 会拒绝它。`code_agent` 走与用户手打 standard 会话相同的 Host create/prompt 路径。

## 影响

在 Computer Use preset 中、具备图片能力的路由上挂载该插件，会在每次请求中增加策略 token、十三个互斥 GUI schema 以及 `code_agent`、`code_agent_status` 和 `code_agent_stop`，再加上首帧通知与每次 GUI 结果的图片 token，直到压缩。纯文本路由仍能用于编码会话：跳过首帧附件，GUI 工具以路由诊断失败。macOS 需要屏幕录制与辅助功能；缺少权限时，捕获或输入会失败，并指出对应的 TCC。`input_text` 在粘贴期间覆盖字符串剪贴板，并在之后恢复。附加截图是跳过 overlay 后的最前应用，不是显示器全景；[Computer Use 焦点窗口观察](2026-09-16-computer-use-focused-window-observation.zh.md) 拥有所有者选取，[Computer Use 应用窗口观察](2026-09-16-computer-use-app-window-observation.zh.md) 拥有家族并集与始终区域捕获，[Computer Use 瞬时窗口观察](2026-09-16-computer-use-transient-window-observation.zh.md) 拥有区域 helper。Desktop 主窗口在 overlay 跳过后仍可被截到；macOS overlay 由 ScreenCaptureKit 窗口排除从 Computer Use 截图中省略，并只在对应的 HID 突发期间点击穿透。观察文本还携带由 [Computer Use 观察前台元数据](2026-09-15-computer-use-observation-foreground.zh.md) 拥有的、跳过 overlay 后的前台标签。没有逐次点击批准、像素差 settle、套索，也没有 `dsh-base` 默认项。

## 测试

包测试只使用假桌面。它们覆盖坐标映射、热键拒绝、工具 execute/render、首帧 pre-step、纯文本拒绝、HMR、通过仅测试 `cordis.yml` 的 Loader 组合，一次进程内 agent-loop 点击把图片块放到 `user/message` 与 `tool/result` 上，仅 overlay 使用的 preset-root locator、overlay YAML（不在 Host 插入 GUI 工具，`agent-presets` 注入 `computerUsePresetRoot`）、该 inject 之后对 `!!js ctx.computerUsePresetRoot` 的 Loader 插值、额外 preset 的 `scanRoot`、Host `schemas()` 中不出现的作用域 GUI 工具，`code_agent` 创建/续写/拒绝路径（追加与侧栏会话相同的 `user/message` 事件），以及停到两边都空闲才 `followup` 的 `code_agent` 完成通知。注入的 macOS `CommandRunner` 测试断言生成的 JXA 含有 `clickAt`、`pasteText`、`chord`、`CGEventCreateScrollWheelEvent2`、`longPressAt` 与 `dragFromTo`，浏览器与 Finder 的 `/usr/bin/open` argv，设置 overlay 窗口 id 时的 helper `--region=` argv，以及不回退到 `screencapture`。

人工编写的 headless overlay [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) 挂载场景本地的假桌面插件，以及视觉模型 `deepseek-v4-flash-vision-exp`，并把 `postActionWaitMs` 设为 `0`。回放使用固定 PNG，绝不驱动真实桌面。该 overlay 会桩掉 `sessionController` 并注册 `code_agent`，以便 header pin 含有 `code_agent*` schema；headless 没有 Session Remote。首帧和 click 结果含 `<frontmost_app>Pages</frontmost_app>`。该插件不在已发布的 `dsh-base` 中。
