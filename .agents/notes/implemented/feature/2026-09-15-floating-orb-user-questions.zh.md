# Agent Note: 悬浮球回答用户提问

Status: implemented

[English](2026-09-15-floating-orb-user-questions.md) | 中文

## 问题

macOS overlay 是只轮询 `session/page` 以显示对话文本的 shell 页。Computer Use 通过 `ask_user_question` 提问，并等待仍在进行的 `'user-questions/request'` waterfall（瀑布式事件）。未决提问不是 session 事件，球无法从历史重建它们。用户只能在主窗口的 Web 界面里看到提示；关掉主窗口后就没有 Client 答题方。

## 决策

overlay 在 Host 就绪后打开 Desktop Host 的 `$events` 流，地址为 `dsh-app://app/.dsh/remote-stream`，载体与注入主窗口的 `__DSH_TRANSPORT__.openStream` 同为 NDJSON。它用 `$events/result` 回送。当 `agentId` 是球已创建或接上的 Computer Use 会话时，它认领 `user-questions/request` waterfall；对其余 waterfall 立即返回 `next()`。已认领的请求在切换历史时仍保持，直到用户作答或取消，或 Host 下发 `cancel`。Gateway 仍把 waterfall 扇出到每个 Client；先到的 `result` 或 `rejected` 生效。

展开面板渲染紧凑的原生 HTML 卡片：题干、可选 header 与 detail、单选与多选、自定义文本框、跳过、分页与放弃。答案 JSON 与 Web composer 相同。`plan-review` 走该通用选项列表。提问到达时展开面板，并像会话运行中一样阻止悬停收起。overlay 不启动 `dsh-app://app/index.html`。overlay 构造见 [桌面悬浮球](2026-09-14-desktop-floating-orb.zh.md)。

## 考虑过的替代方案

**在 overlay 里加载打包的 Web 客户端。** 那会复用 `QuestionComposer`，但也会启动紧凑球上不能出现的模式选择器。[悬浮球决策](2026-09-14-desktop-floating-orb.zh.md) 已经否决这一条。

**从 `session/page` 投影未决提问。** user-questions seam 不发布独立的请求/答案审计流。日志里只有随后的 `tool/call` 与 `tool/result`，因此无法重建仍在等待的提问。

**增加 Host RPC 列出未决提问供 overlay 轮询。** 那会重复 waterfall，并且仍要用 `$events/result` 结算。在现有 Desktop 流载体上打开 `$events` 才是 Client 协议。

## 影响

overlay 是第二个 Gateway Client。关掉主窗口后，Computer Use 提问仍有答题方。在球上作答会取消主窗口卡片；在主窗口作答会拆掉球上的卡片。逐次点击的 Computer Use 批准仍然没有。overlay 渲染测试用 mock 的 NDJSON `$events` 流覆盖认领、选项提交、自定义文本、跳过、取消、对其它 agent 的 `next()`、Host `cancel`，以及历史切走再切回。
