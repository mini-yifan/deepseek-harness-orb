# Agent Note: 实验性 Computer Use 插件

Status: implemented

[English](2026-09-13-experimental-computer-use.md) | 中文

## 问题

视觉模型已经能消费工具结果或用户消息携带的图片块，但已发布的 agent-loop 没有宿主插件去捕获实时桌面、把 0–1000 坐标空间映射到显示器，并发送 GUI 输入。把该行为放进 Skill 会让它离开工具目录。为了截屏去改 `agent-loop`，会把视觉桌面控制变成 loop 特性，而不是组合选择。observe/screenshot 工具会浪费一轮，而下一次 GUI 动作本来就必须再截一次。

## 决策

`@deepseek-ai/dsh-experimental-tool-computer-use` 是私有实验性 Cordis 插件。它注册五个互斥 GUI 工具（`click`、`input_text`、`scroll`、`hotkey`、`wait`），并通过 `agent/pre-step` 在首次用户回合附上当前屏幕。每个工具执行一次桌面动作，等待 `postActionWaitMs`，重新截屏，并由 `output.render` 返回 `[文本信封, ...ImageBlock]`。图片放在内容里，不放在 `presentationMeta`。没有截屏工具。

`applyComputerUse(ctx, backend, config)` 是共享注册助手。生产环境的 `apply` 使用宿主平台后端（macOS 捕获与 HID 输入；其他平台在执行时抛出固定的仅 macOS 错误）。测试与无密钥 snapshot 注入返回固定 PNG 并记录动作的假桌面。没有 Config `driver: fake`。macOS HID 发送由 [Computer Use macOS HID](../bug-fix/2026-09-13-computer-use-macos-hid.zh.md) 负责。

插件注入 `tools`、`systemPrompt` 与 `attachments`。缺少 attachments 时保持 pending。可选的 `llm` 负责图片路由门禁：纯文本路由跳过首帧图片并拒绝这些工具。安装或 patch 插件就是同意门槛；工具不会对每次点击 `ask`。插件不在 `dsh-base` 中。本地试用是 `pnpm dsh web --patch packages/experimental/tool-computer-use/cordis.source.patch.yml`，然后在新会话上选择 Computer Use agent preset。Desktop 把同一包作为签名 runtime extra 拷贝，并由 Desktop Host 挂上 locator，而不是作为 npm 依赖；见 [桌面悬浮球](2026-09-14-desktop-floating-orb.zh.md)。

Web overlay 只插入 `computer-use-preset-root`，由它提供本包旁的额外 `trust: system` agent-presets 根目录。overlay 在 `agent-presets` 行上加上 `inject: [computerUsePresetRoot]`，因此 Loader 插值 `!!js ctx.computerUsePresetRoot` 会等到该服务就绪。GUI 工具注册在该 preset 的常驻作用域里。Host 目录与随附的 `standard` preset 都不会收到它们。Computer Use preset 还会注册 `code_agent`，它通过 `session.create` / `session.prompt` 创建或续写一等 standard 会话，以便桌面侧栏显示委派工作。接受之后，调用方拥有的监视会把插件通知停到两边都空闲再投递；[Computer Use 把 Code agent 完成通知停到空闲再投递](2026-09-15-computer-use-code-agent-completion.zh.md) 拥有这条投递路径。

接地文案是 `systemPrompt.section`。坐标是每屏 0–1000。系统截屏组合键（Cmd/Win+Shift+3/4/5）会被拒绝。

## 考虑过的替代方案

**只用 Skill 做接地。** Skill 可以携带 See/Step 文案，但不能注册工具、附加持久图片，或出现在生成的工具目录中。Computer Use 是带提示词分节的 Cordis 插件，由 Computer Use agent preset 组合。

**把 GUI 工具插到 Host。** Host 注册的工具会出现在每个 preset 中，包括 `standard`。overlay 改为追加一个系统 extra root，因此只有点名 `computer-use` 的会话才会收到五个 GUI 工具。

**改 `agent-loop`。** loop 已经会把工具结果中的图片送入下一次请求。loop 特例会让桌面控制变成核心语义，并迫使每个组合都了解屏幕。

**Observe/screenshot 工具。** 专用捕获工具会增加一轮，其唯一工作是一张图片，而下一个 GUI 工具在动作后还必须再截。观察属于首次用户回合和每次 GUI 结果。

**每次点击都 `ask`。** 交互 seam 的 `allowed-once` 授权无法让视觉循环可用。同意门槛是安装或 patch 这个实验插件；README 写明它驱动真实的未沙箱化桌面。

**本轮做成能力 seam。** 一个包同时拥有 macOS 后端、工具与 pre-step。第二个后端（Playwright / Electron）才值得把 Service Definition 与 Provider 拆开。

**本轮做 Windows/Linux 输入。** 非 macOS 宿主仍会加载，以便 Linux CI 挂载假后端。生产方法在执行时抛错。

**用 `tool-subagent` 做后台编码。** `origin: 'subagent'` 会把子会话从工作区侧栏藏掉，并且 `session.prompt` 会拒绝它。`code_agent` 走与用户手打 standard 会话相同的 Host create/prompt 路径。

## 影响

在 Computer Use preset 中、具备图片能力的路由上挂载该插件，会在每次请求中增加策略 token、五个互斥 GUI schema 以及 `code_agent`，再加上首帧通知与每次 GUI 结果的图片 token，直到压缩。纯文本路由仍能用于编码会话：跳过首帧附件，GUI 工具以路由诊断失败。macOS 需要屏幕录制与辅助功能；缺少权限时，捕获或输入会失败，并指出对应的 TCC。`input_text` 在粘贴期间覆盖字符串剪贴板，并在之后恢复。Web chrome 会出现在截屏中。Desktop 主窗口始终可被截到；macOS overlay 由 ScreenCaptureKit 窗口排除从 Computer Use 截图中省略，并只在对应的 HID 突发期间点击穿透。没有逐次点击批准、像素差 settle、拖拽，也没有 `dsh-base` 默认项。

## 测试

包测试只使用假桌面。它们覆盖坐标映射、热键拒绝、工具 execute/render、首帧 pre-step、纯文本拒绝、HMR、通过仅测试 `cordis.yml` 的 Loader 组合，一次进程内 agent-loop 点击把图片块放到 `user/message` 与 `tool/result` 上，仅 overlay 使用的 preset-root locator、overlay YAML（不在 Host 插入 GUI 工具，`agent-presets` 注入 `computerUsePresetRoot`）、该 inject 之后对 `!!js ctx.computerUsePresetRoot` 的 Loader 插值、额外 preset 的 `scanRoot`、Host `schemas()` 中不出现的作用域 GUI 工具，`code_agent` 创建/续写/拒绝路径（追加与侧栏会话相同的 `user/message` 事件），以及停到两边都空闲才 `followup` 的 `code_agent` 完成通知。注入的 macOS `CommandRunner` 测试断言生成的 JXA 含有 `clickAt`、`pasteText`、`chord` 与 `CGEventCreateScrollWheelEvent2`，设置 overlay 窗口 id 时的 helper argv，以及不回退到 `screencapture`。

人工编写的 headless overlay [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) 挂载场景本地的假桌面插件，以及视觉模型 `deepseek-v4-flash-vision-exp`，并把 `postActionWaitMs` 设为 `0`。回放使用固定 PNG，绝不驱动真实桌面。该 overlay 会桩掉 `sessionController` 并注册 `code_agent`，以便 header pin 含有该 schema；headless 没有 Session Remote。该插件不在已发布的 `dsh-base` 中。
