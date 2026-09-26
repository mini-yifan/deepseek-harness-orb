# Agent Note: Overlay Compact ChatView

Status: implemented

[English](2026-09-16-overlay-compact-chat.md) | 中文

## 问题

macOS 悬浮球展开的 320×420 shell 页把对话记录做成了第二套气泡聊天：深色用户胶囊、助手气泡、每 1.5s 轮询 `session/page`，以及每次刷新都执行 `scrollTop = scrollHeight`。那套记录无法显示 Compact 过程行（上下文注入、一行思考、工具行、无气泡 markdown）或 ChatView 跟随。若把 `dsh-app://app/index.html` 当作 overlay 文档加载，会启动紧凑球上不能出现的 AppFrame 和模式选择器。

## 决策

overlay 文档仍是 [`apps/desktop/renderer/floating.html`](../../../../apps/desktop/renderer/floating.html)。`#transcript` 只在 Host 就绪时承载 `dsh-app://app/index.html?surface=overlay` 的 iframe，每一代 Host 重建，折叠后保留。[`ui-overlay-chat`](../../../../packages/client/ui-overlay-chat/README.zh.md) 只在该查询上占用 `'root'`，声明会话作用域的 `conversation.view`，并渲染 ChatView。[`ui-layout`](../../../../packages/client/ui-layout/README.zh.md) 跳过 AppFrame `'root'`，仍提供 `ctx.layout`，以及应用 Host 已解析调色板并向 shell 发送 `dsh.overlay.theme` 的 ThemePresenter；[overlay 外观](2026-09-18-overlay-appearance-follows-host.zh.md) 拥有在不写入设置的前提下跟随 Host。[`ui-chat`](../../../../packages/client/ui-chat/README.zh.md) 强制 Compact。[`ui-user-questions`](../../../../packages/client/ui-user-questions/README.zh.md) 始终 `next()`，因此原生 [`floating.js`](../../../../apps/desktop/renderer/floating.js) 仍是 overlay `'user-questions/request'` 认领方。

overlay 文档上的 ClientSessions 选中项持久化在 `dsh.overlay.sessions.current`。iframe 与主窗口共享 `dsh-app://app` 源；共用 `dsh.sessions.current` 会抢走主窗口选中项。shell 从 `dsh-app://shell` 发送 `{ type: 'dsh.overlay.session', sessionId }`；iframe 回复 `{ type: 'dsh.overlay.ready' }` 并调用 `sessions.open`，不整页重载。

原生外壳保持不变：320×420 面板、72px 球、灰色输入胶囊、历史 / 新建、停止、Computer Use + Flash/Max、`floating-session.json`，以及提问卡。历史仍隐藏 `#transcript`。提问不再隐藏对话记录。ChatView 拥有跟随（`FOLLOW_THRESHOLD` 24px）。Overlay CSS 设置 `--dsh-chat-content-width: 100%` 与 `--dsh-composer-side-clearance: 0px`，并隐藏 `[data-chat-turn-rail]`。[Overlay 消息操作](../bug-fix/2026-09-17-overlay-message-actions-narrow.zh.md) 拥有 IconActions 溢出、iframe clipboard-write，以及 overlay 上的 `conversation.input.overlay` 座位。

overlay 构造见 [桌面悬浮球](2026-09-14-desktop-floating-orb.zh.md)，shell waterfall 见 [悬浮球回答用户提问](2026-09-15-floating-orb-user-questions.zh.md)。

## 考虑过的替代方案

**把 `index.html` 当作 overlay 文档加载。** 那会复用 ChatView，但也会启动模式选择器。iframe 是嵌套的 Compact 界面，不是第二扇 AppFrame 窗口。

**在 `floating.js` 里移植一套原生 Compact。** 那会重写 ChatView、实时块、markdown 和跟随。iframe 复用已发布管线。

**调用 `theme.setTheme('light')`。** 那会写入 Host 设置并翻转主窗口。overlay 主题呈现仍只作用于本文档；[overlay 外观](2026-09-18-overlay-appearance-follows-host.zh.md) 拥有在不那样写入的前提下跟随 Host。

**让 iframe 认领 `'user-questions/request'`。** 那会在主窗口和 `floating.js` 之外再增加第三个 waterfall 客户端。iframe 调用 `next()`；shell 卡片仍是 overlay 答题方。

## 影响

overlay iframe 是第三个 Gateway Client，只用于 Session follow，不用于提问。打开球上的对话只写入 `dsh.overlay.sessions.current`。`sidebarRight` 留在名册里以满足 `ui-chat` 的 inject；`openFile` 没有右侧栏。`ui-conversation` 在 overlay 上从不声明 `conversation.view`，因为它向 `main` 的 inject 会等待 AppFrame。

未打包 Desktop 从工作区虚拟提升目录准备 `.desktop-build/development/project`。像 `ui-overlay-chat` 这样只出现在 web-app 依赖里的插件可能不在该提升目录中；`prepareDevelopmentProject` 会从 `@deepseek-ai/dsh-web-app` 和 `@deepseek-ai/dsh-base` 的嵌套 `node_modules` 补上剩余名称。`start:desktop`（`--skip-build`）会重建 `session-controller`、`ui-layout`、`ui-chat`、`ui-user-questions` 和 `ui-overlay-chat`，使 Host loader 与 overlay iframe 的客户端半部存在。

## 测试

Desktop 渲染测试钉住 iframe `src`、没有 `.bubble.assistant`、Session postMessage、历史隐藏 iframe、提问不隐藏 iframe，以及不轮询 `session/page`。`ui-overlay-chat` gui 规格钉住 Compact 根、内容宽度 CSS，以及 `open(sessionId)`。`ui-layout` 在 overlay 上跳过 AppFrame root。`session-controller` 持久化名跟随 `?surface=overlay`。`ui-user-questions` 在 overlay 上始终 `next()`。`ui-chat` 在 overlay 上强制 Compact。Desktop `development-project` 测试钉住 web-app 嵌套的 `@deepseek-ai/dsh-client-ui-overlay-chat` 在提升目录省略时仍出现在生成的项目中。
