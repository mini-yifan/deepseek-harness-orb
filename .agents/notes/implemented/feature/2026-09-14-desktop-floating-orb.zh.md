# Agent Note: 桌面悬浮球与双 Agent

Status: implemented

[English](2026-09-14-desktop-floating-orb.md) | 中文

## 问题

Computer Use 是 Web `--patch` 可以挂上的实验 overlay，但 Desktop 把 Web UI 打成只有 `standard` 默认的一扇主窗口。若用户想在同一桌面壳里同时做 GUI 控制与后台编码，否则就得再开一份完整 Web 客户端、在紧凑 overlay 上放模式选择器，或使用会被侧栏藏掉的 `tool-subagent` 子会话。

## 决策

macOS Desktop 在 Host 就绪后创建第二扇 Electron overlay：72px 置顶 panel，通过现有 shell preload 加载 `dsh-app://shell/floating.html`。该页 fetch 与主窗口相同的 Host `/api`。它不启动 `dsh-app://app/index.html`。Windows 保持今天的单主窗口。

overlay 会话在 `$DSH_HOME/dsh_orb` 上 `workspace.create` 后调用 `session.create({ agentPreset: 'computer-use', workspaceId })`（侧栏标题 `dsh_orb`），并在每次打开时选择 `deepseek-flash`、思考强度 `max`。当前 overlay id 以 `floating-session.json` 存在 Desktop profile。主窗口保持当前会话；overlay 会话以及 cwd 匹配该工作区的 `code_agent` 行出现在 `dsh_orb` 下。SessionHeader origin 不变。

overlay 是 72px GIF 球：悬停以 300ms 展开 320×420 白底面板，球留在输入胶囊一角。单击固定面板；再点取消固定，指针离开两者后 180ms 折叠。指针仍在 overlay 上时取消固定会保持面板展开。收起时球留在展开角，直到窗口缩到 72px。拖动按球上的指针偏移记录，立刻收起，再按球原点移动，已存储的展开方向不会带动球。仅在 pointerup 时夹入工作区，不吸边。回车发送；停止是 body 兄弟（`#ball` z-index 1，`#stop` z-index 2），放在输入胶囊里与球相对的一端，仅 Computer Use 会话运行时显示并替换被隐藏的输入；点击对该 overlay 会话调用 `session/cancel`。历史会把气泡换成 cwd 为 `dsh_orb` 且投影 preset 为 `computer-use` 的会话；委派出去的 standard 与 `code_agent` 行不进该列表。点击一行会把该 id 写入 `floating-session.json` 并恢复气泡，后续提示词继续那条对话。新建会在 `dsh_orb` 上再开一条 Computer Use 会话。

`code_agent` 只注册在 Computer Use preset。创建走 `session.create({ agentPreset: 'standard' })`，不设 `origin: 'subagent'`，也不传 `parentAgent`。发送任务走 `mode: 'queue'`，返回 `{ accepted: true }`，不等待回合结束。省略 `session_id` 会新建空白 standard 会话；带上先前结果 id 则在那条会话再入队一条用户消息。Computer Use 策略要求模型把可见 GUI 留在五件套上，用先前 id 续写同一产物，无关新工作则不带 id。

Desktop Host overlay YAML 从 `../lib/computer-use-preset-root.js` 插入 `computer-use-preset-root`，并从 `../lib/computer-use-overlay-guard.js` 插入 `computer-use-overlay-guard`，并保持 `default: standard` 且开启模式选择。`prepare-dsh` 把 `@deepseek-ai/dsh-experimental-tool-computer-use` 作为 runtime extra 拷进 `extraResources/dsh`，并把 preset 组合改写为 `lib/*.js`。发布应用仍不得在 `dependencies` 中点名该实验包。主窗口始终可被截到。overlay 只在对应的 Computer Use 区间里通过 ScreenCaptureKit `excludingWindows` 排除截屏并点击穿透；见 [桌面 overlay-guard](../architecture/2026-09-14-desktop-overlay-guard.zh.md)。overlay 通过 `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })` 留在每个 Space 和全屏之上。创建 overlay 后 Desktop 调用 `app.setActivationPolicy('regular')` 和 `app.dock.show()`，Dock 图标保持可见。应用菜单包含标准 Edit 与 Window。overlay 右键在可编辑目标上增加剪切/复制/粘贴。

[Computer Use 插件决策](2026-09-13-experimental-computer-use.zh.md) 仍拥有 GUI 工具、策略文本与实验同意门槛。

## 考虑过的替代方案

**在 overlay 里再开一份完整 Web 客户端。** 加载 `dsh-app://app/index.html` 会启动整棵客户端，包括紧凑球上不能出现的模式选择器。shell 页改为复用 Host RPC。

**把 Desktop profile 默认锁成 `computer-use`。** 那会把主窗口也锁死在 Computer Use。overlay 创建时点名 preset；已发布默认仍是 `standard`。

**用 `tool-subagent` 做后台编码。** 侧栏会过滤 `origin: 'subagent'`，且 `session.prompt` 会拒绝这些 id。委派工作必须是一等 standard 会话。

**给球会话加新的 SessionHeader origin。** 那会为仅 Desktop 的分组去抬 `SESSION_FORMAT_VERSION`。挂到 `dsh_orb` 工作区已经够用。

**把实验包写成 Desktop Host 依赖。** 实验组 AGENTS.md 禁止发布应用点名它。runtime extra 拷贝是这条例外；locator 放在 Desktop Host。

**本轮做 Windows overlay。** 球依赖 macOS `type: 'panel'` 与带 `skipTransformProcessType` 的 `setVisibleOnAllWorkspaces`。Windows 仍是一扇窗口。

**把停止放在球上。** 那会盖住 GIF，并和拖动/固定共用一角。停止放在胶囊相对的 72px 端、内缩 14px，作为 body 兄弟叠在胶囊之上。

## 影响

在 darwin 上关掉主窗口后，球仍会运行，直到从 Dock、Cmd+Q 或 overlay 右键明确退出。overlay 没有语音、套索、划词工具条或逐次点击批准。overlay 的截屏排除与点击穿透只包住 Computer Use 区间；捕获省略使用整扇 overlay 窗的 ScreenCaptureKit 窗口 id。重启会在 Host 仍持有该会话时续上已存 Computer Use 会话。overlay Computer Use 的 cwd 是 `$DSH_HOME/dsh_orb`。snapshot 与包测试钉住 `code_agent` 路由例子（微信/Pages 走 GUI、Word 新建、字体改绿续写、五子棋新建），以及仅 macOS 的 overlay 构造。

## 测试

Desktop 拷贝 runtime extra，并把 overlay YAML 保持在 `default: standard`。Computer Use 包测试覆盖 `code_agent` 创建时没有 subagent origin、caller cwd 匹配工作区时带 `workspaceId` 创建、按 `session_id` 续写、拒绝 CU/subagent/cwd 冲突，以及续写会话上的两条 `user/message` 对比省略 id 时的新会话。computer-use snapshot overlay 会桩掉 `sessionController`，以便 header pin 含有 `code_agent` schema。客户端 tree 测试仍会省略作为 `hiddenSessionIds` 传入的 id，并保留委派出的 standard 行。Electron 测试在 darwin 创建 `type: 'panel'` overlay，在非 darwin 不创建，默认让两扇窗口都可被截到，传入 `skipTransformProcessType: true`，并在创建 overlay 后调用 `app.setActivationPolicy('regular')` 和 `app.dock.show()`。它们还钉住应用 Edit 菜单、overlay 可编辑区粘贴项、保持球原点的展开几何、展开态 `moveFloatingBall` 不夹面板，以及不吸边的工作区夹取。overlay 渲染页会创建 `dsh_orb` 工作区，通过 Host RPC 创建 Computer Use 会话并选择 DeepSeek-V41-Flash、思考模式 Max，回车发送，把停止放在输入胶囊里与球相对的一端，在发送后显示停止并在点击时调用 `session/cancel`，在收起后用球抓取偏移拖动，并在指针仍在球上时取消固定保持面板展开，还会从历史列出仅 `dsh_orb` 上的 Computer Use 对话（省略委派 standard 行），并接上选中的 id 以便继续发送。
