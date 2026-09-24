# Agent Note: Overlay 长时钟下消息操作仍可点击

Status: implemented

[English](2026-09-17-overlay-message-actions-narrow.md) | 中文

## 问题

320px 悬浮球 Compact Chat iframe 在每条已定稿消息下显示 IconActions。当天时钟是 `HH:mm`；其他日期会加上 `clock.md` / `clock.ymd`（`9月16日 16:23`）。更长的标签加上复制、点赞、点踩、分支和收起后的统计胶囊会溢出该行。Flex 子项被压到 28px 以下，nowrap 时钟文字画到相邻控件上，点击就打不中目标。

复制也不写入剪贴板：shell 是 `dsh-app://shell`，对话记录 iframe 是 `dsh-app://app`，因此 `navigator.clipboard.writeText` 需要 `allow="clipboard-write"`。没有它时写入被拒绝，`writeClipboard` 返回 false，IconActions 不显示对勾。点赞/点踩调用 `openDialog` 却没有 `conversation.input.overlay` 宿主，FeedbackDialog 从未挂载。

[Overlay Compact ChatView](../feature/2026-09-16-overlay-compact-chat.zh.md) 仍拥有 iframe 和 Compact Chat 根。本笔记拥有 IconActions 行、overlay 剪贴板许可，以及 overlay 上的 `conversation.input.overlay` 座位。

## 决策

图标按钮（`MessageIconActions` 的复制/分支和 `MessageFeedbackActions` 的评分）使用 `flex: none`。时钟吸收溢出：`min-width: 0`、`overflow: hidden`、`text-overflow: ellipsis`，仍保持一行 28px。480px 以下，收起的轮次用量/耗时胶囊也是 `flex: none`。行本身是 `max-width: 100%`。

overlay iframe 设置 `allow="clipboard-write"`。`writeClipboard` 仍优先 `clipboard.writeText`；拒绝后回落到 `execCommand('copy')`。OverlayChatRoot 声明并渲染 `conversation.input.overlay` 作为零尺寸宿主，以便 FeedbackDialog 经 body portal 挂载 Modal。悬浮球 shell 仍拥有输入框。

## 考虑过的替代方案

**把时钟折到第二行。** 能保住完整日期，但会改掉每个窄栏（包括主窗口）上 28px 的 Figma 行。

**在 `?surface=overlay` 上隐藏时钟。** 任何窄 Compact 栏都有同样的溢出；共享省略号是同一条规则。

**Desktop 剪贴板 IPC。** 为 Web Clipboard Policy 缺失再加一层 preload。`allow` 加上 `execCommand` 就是现有助手的第二条路径。

**让 overlay 上的点赞/点踩保持无效。** 按钮是可见的；缺少 overlay 座位才会让它们看起来点不了。

## 后果

非当天时钟可能会省略（`9月16日…`）而不是折行。Overlay 仍然没有 composer；除 FeedbackDialog 以外、假定存在输入卡片的 input-overlay 条目会得到零尺寸宿主。

## 测试

`chat-font-axis-styles.client.spec.ts` 钉住 `.action` 的 `flex: none`、时钟省略、行 `max-width: 100%`，以及窄视口胶囊的 `flex: none`。`chat-branch-tails.client.spec.tsx` 在复制旁渲染非当天用户时钟。`MessageFeedbackActions` 样式规格钉住 `flex: none`。`writeClipboard` 测试覆盖拒绝后走 execCommand，以及拒绝且无回落。Desktop `floating-renderer.spec.ts` 钉住 iframe `allow="clipboard-write"`。`ui-overlay-chat` 规格钉住 overlay root 上的 `conversation.input.overlay` 以及 OverlayChatRoot 的渲染调用。
