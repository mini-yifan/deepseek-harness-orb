# Agent Note: 实验性 Computer Use 插件

Status: implemented

[English](2026-09-13-experimental-computer-use.md) | 中文

## 问题

视觉模型已经能消费工具结果或用户消息携带的图片块，但已发布的 agent-loop 没有宿主插件去捕获实时桌面、把 0–1000 坐标空间映射到显示器，并发送 GUI 输入。把该行为放进 Skill 会让它离开工具目录。为了截屏去改 `agent-loop`，会把视觉桌面控制变成 loop 特性，而不是组合选择。observe/screenshot 工具会浪费一轮，而下一次 GUI 动作本来就必须再截一次。

## 决策

`@deepseek-ai/dsh-experimental-tool-computer-use` 是私有实验性 Cordis 插件。它注册五个互斥 GUI 工具（`click`、`input_text`、`scroll`、`hotkey`、`wait`），并通过 `agent/pre-step` 在首次用户回合附上当前屏幕。每个工具执行一次桌面动作，等待 `postActionWaitMs`，重新截屏，并由 `output.render` 返回 `[文本信封, ...ImageBlock]`。图片放在内容里，不放在 `presentationMeta`。没有截屏工具。

`applyComputerUse(ctx, backend, config)` 是共享注册助手。生产环境的 `apply` 使用宿主平台后端（macOS 捕获与 HID 输入；其他平台在执行时抛出固定的仅 macOS 错误）。测试与无密钥 snapshot 注入返回固定 PNG 并记录动作的假桌面。没有 Config `driver: fake`。macOS HID 发送由 [Computer Use macOS HID](../bug-fix/2026-09-13-computer-use-macos-hid.zh.md) 负责。

插件注入 `tools`、`systemPrompt` 与 `attachments`。缺少 attachments 时保持 pending。可选的 `llm` 负责图片路由门禁：纯文本路由跳过首帧图片并拒绝这些工具。安装或 patch 插件就是同意门槛；工具不会对每次点击 `ask`。插件不在 `dsh-base` 中。本地试用是 `pnpm dsh web --patch packages/experimental/tool-computer-use/cordis.source.patch.yml`。

接地文案是 `systemPrompt.section`。坐标是每屏 0–1000。系统截屏组合键（Cmd/Win+Shift+3/4/5）会被拒绝。

## 考虑过的替代方案

**只用 Skill 做接地。** Skill 可以携带 See/Step 文案，但不能注册工具、附加持久图片，或出现在生成的工具目录中。Computer Use 是带提示词分节的 Host 插件。

**改 `agent-loop`。** loop 已经会把工具结果中的图片送入下一次请求。loop 特例会让桌面控制变成核心语义，并迫使每个组合都了解屏幕。

**Observe/screenshot 工具。** 专用捕获工具会增加一轮，其唯一工作是一张图片，而下一个 GUI 工具在动作后还必须再截。观察属于首次用户回合和每次 GUI 结果。

**每次点击都 `ask`。** 交互 seam 的 `allowed-once` 授权无法让视觉循环可用。同意门槛是安装或 patch 这个实验插件；README 写明它驱动真实的未沙箱化桌面。

**本轮做成能力 seam。** 一个包同时拥有 macOS 后端、工具与 pre-step。第二个后端（Playwright / Electron）才值得把 Service Definition 与 Provider 拆开。

**本轮做 Windows/Linux 输入。** 非 macOS 宿主仍会加载，以便 Linux CI 挂载假后端。生产方法在执行时抛错。

## 影响

在具备图片能力的路由上挂载该插件，会在每次请求中增加策略 token 与五个互斥 schema，再加上首帧通知与每次 GUI 结果的图片 token，直到压缩。纯文本路由仍能用于编码会话：跳过首帧附件，GUI 工具以路由诊断失败。macOS 需要屏幕录制与辅助功能；缺少权限时，捕获或输入会失败，并指出对应的 TCC。`input_text` 在粘贴期间覆盖字符串剪贴板，并在之后恢复。Web/Electron chrome 会出现在截屏中。没有逐次点击批准、chrome 排除、像素差 settle、拖拽，也没有 `dsh-base` 默认项。

## 测试

包测试只使用假桌面。它们覆盖坐标映射、热键拒绝、工具 execute/render、首帧 pre-step、纯文本拒绝、HMR、通过仅测试 `cordis.yml` 的 Loader 组合，以及一次进程内 agent-loop 点击，把图片块放到 `user/message` 与 `tool/result` 上。注入的 macOS `CommandRunner` 测试断言生成的 JXA 含有 `clickAt`、`pasteText`、`chord` 与 `CGEventCreateScrollWheelEvent2`。

人工编写的 headless overlay [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) 挂载场景本地的假桌面插件，以及视觉模型 `deepseek-v4-flash-vision-exp`，并把 `postActionWaitMs` 设为 `0`。回放使用固定 PNG，绝不驱动真实桌面。该插件不在已发布的 `dsh-base` 中。
