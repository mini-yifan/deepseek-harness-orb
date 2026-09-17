---
description: "桌面悬浮球 overlay iframe 的 Compact Chat 根；供 macOS overlay 对话记录的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-overlay-chat

[English](README.md) | 中文

## 概述

当文档查询为 `?surface=overlay` 时，本包占用浏览器 `'root'` 槽并渲染 Compact Chat。桌面悬浮球保留自己的 shell 页，并在对话记录 iframe 里承载本文档，因此思考、工具、上下文注入、markdown、实时流式输出和 ChatView 跟随全部来自主窗口 Chat 管线，且不挂载 AppFrame 或模式选择器。

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

把本插件挂进 Web 组合。在主窗口文档上它是空操作。在 `dsh-app://app/index.html?surface=overlay` 上它拥有 `'root'`，声明会话作用域的 `conversation.view` 与 `conversation.input.overlay`，并且只渲染 ChatView。悬浮球 shell 会 post 球会话 id；本插件调用 `sessions.open`，不整页重载。没有 Config。

### 隔离

iframe 与主窗口共享 `dsh-app://app` 源。ClientSessions 选中项持久化在 `dsh.overlay.sessions.current`，而不是 `dsh.sessions.current`，因此打开球上的对话不会抢走主窗口选中项。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

除非 `overlayClientSurface()` 为真，否则插件立即返回。一个 effect 把 `OverlayChatRoot` 注册到 `'root'` 并声明 `conversation.view` 与 `conversation.input.overlay`；`ui-layout` 在该文档上跳过 AppFrame，因此不会出现两个 `'root'` 占用者。`ui-conversation` 等待注入 `main.conversation`，在此从不声明 `conversation.view`。shell 从 `dsh-app://shell` 发送 `{ type: 'dsh.overlay.session', sessionId }`；iframe 回复 `{ type: 'dsh.overlay.ready' }`，并重试 `sessions.open` 直到 Host 列表包含该 id。Overlay CSS 设置 `--dsh-chat-content-width: 100%`、`--dsh-composer-side-clearance: 0px`，隐藏 `[data-chat-turn-rail]`，并绘制白底文档。`ui-chat` 强制 Compact。`ui-user-questions` 始终 `next()`，因此原生 `floating.js` 仍是 overlay waterfall 认领方。iframe 设置 `allow="clipboard-write"`；[overlay 消息操作](../../../.agents/notes/implemented/bug-fix/2026-09-17-overlay-message-actions-narrow.zh.md) 拥有该许可、IconActions 时钟省略，以及零尺寸 input-overlay 宿主。[overlay Compact ChatView Agent Note](../../../.agents/notes/implemented/feature/2026-09-16-overlay-compact-chat.zh.md) 拥有 Compact 根决策。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [桌面悬浮球](../../../.agents/notes/implemented/feature/2026-09-14-desktop-floating-orb.zh.md) — overlay 构造与 Computer Use 会话。
- [ui-chat](../ui-chat/README.zh.md) — 本根渲染的 Compact ChatView。
- [ui-layout](../ui-layout/README.zh.md) — 跳过 AppFrame 以及 overlay 浅色 ThemePresenter。
- [桌面端用户指南](../../../docs/user/guide/desktop.zh.md) — 面向产品的 overlay 外壳。

-----

<a id="model-experience"></a>
## 模型体验

无；本包为人类渲染已经记入日志的 Session，不触及提示词、消息、schema、流或工具结果。

#### KV Cache effect

无；本包从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了 overlay Compact 根。它们是当前包约束，不是桌面 overlay 积压。

- **没有 composer、hero 或侧栏** — 悬浮球 shell 拥有历史、新建、输入胶囊、停止和提问卡。本包不声明 `conversation.composer`。它会把 `conversation.input.overlay` 挂成零尺寸座位，以便 FeedbackDialog 做 portal。
- **提问留在 shell 上** — iframe 对 `'user-questions/request'` 调用 `next()`，因此关掉主窗口后 overlay 仍只有 `floating.js` 这一个答题方。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包。本包只在 overlay 文档上占用 `'root'`，并通过 HMR 安全规格证明注销。
