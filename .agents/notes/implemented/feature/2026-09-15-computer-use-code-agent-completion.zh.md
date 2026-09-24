# Agent Note: Computer Use 把 Code agent 完成通知停到空闲再投递

Status: implemented

[English](2026-09-15-computer-use-code-agent-completion.md) | 中文

## 问题

`code_agent` 已经会把任务入队到一等 standard 会话，并返回 `{ accepted: true }`，不等待该会话结束。之后没有任何东西告诉 Computer Use 调用方后台做完了，于是 overlay 模型要么一直不结束回合（球停在停止、藏起输入），要么空闲后也没有后续汇报。用户没法在 Code 会话运行时继续和 Computer Use 聊天，也永远听不到后台做成了什么。

## 决策

`session.prompt({ mode: 'queue' })` 接受之后，`code_agent` 在调用方 Computer Use agent 的 `ctx.effect` 上启动监视，并放在 `agents.withoutInitiator` 下。`execute` 仍然立即返回，也不会把 `exec.signal` 带进监视，因此之后 Computer Use 的停止不会取消那条一等 Code 会话。`code_agent_stop` 会中止该监视，避免为被取消的那一轮再 followup 完成通知；[Overlay Computer Use 后台调度](2026-09-17-orb-code-agent-dispatch.zh.md) 拥有停止。

Code 区间从该提示词的持久 `rpcId` 起到下一次整 agent 空闲。若 Code agent 仍是 `idle` 且提示词还在收件箱里，监视会先等到 `running`（或销毁）再调用 `whenIdle()`，避免空闲时的 `whenIdle()` 在工作开始前就结束。用户在侧栏继续给那条 Code 会话发消息，会把通知推迟到该会话空闲。

Code 会话空闲后，监视从 `deriveMessages()` 读取最后一条助手文本，等到 Computer Use 调用方空闲，再检查 `agents.get(caller.id) === caller`，然后 `followup` 一条 `source.kind: 'plugin'` 通知（`plugin: 'tool-code-agent'`，`form: 'notice'`）。它不会 `inject` 进正在运行的 Computer Use 回合。接受之后找不到活的 Code agent、调用方已销毁、或同一 id 上的替换 agent，都会丢掉通知，且不让工具失败。

策略、`code_agent` 描述、工具结果信封和 Computer Use 人设要求模型汇报后台 agent 正在运行，仅当本轮 GUI 不依赖该结果时继续，否则结束本回合，并且不要用 `wait` 或 bash sleep 去轮询。之后的插件通知是模型决定下一段的时机。[Computer Use 后台职能](2026-09-22-computer-use-background-role.zh.md) 拥有这一划分。

[实验性 Computer Use](2026-09-13-experimental-computer-use.zh.md) 仍拥有 GUI 工具和 Computer Use preset。[桌面悬浮球](2026-09-14-desktop-floating-orb.zh.md) 仍拥有 overlay 构造和一等 `code_agent` 会话。

## 考虑过的替代方案

**把 `code_agent` 包进 `ctx.jobs`。** tool-jobs 会向忙碌的所有者 inject，并让模型去用 `job_output` / `job_kill`，把工作当成所有者圈起来的后台任务，而不是侧栏里的 standard 会话。`code_agent` 存在的原因就是要保住那条一等会话。

**在 `execute` 里等待 Code 回合。** 那会把 Computer Use 工具调用钉在整段后台运行上，让 overlay 一直 `running`，并和 `isConcurrencySafe` 冲突。

**把通知 `inject` 进忙碌的 Computer Use 回合。** 正在跑的 GUI 回合不能在还有 `next-step` 收件箱项时关闭，因此 Code 完成会拉长或打断点击/输入。调用方 `whenIdle()` 之后再 `followup`，不会动那一轮。

**在 Computer Use 常驻作用域上 `ctx.on('agent/status')`。** `agent/status` 按该 agent 做作用域过滤。Code 会话是没有 `parentAgent` 的兄弟 standard agent；监视必须订在 `code.ctx` 上（或对该 Agent 调用 `whenIdle()`）。

## 影响

下一步点击依赖后台结果时，Computer Use 在入队后结束回合，overlay 输入会回来，用户就可以在 Code 会话运行时继续发 GUI 或聊天。完成通知是 Computer Use 日志上的合成用户消息；模型再决定下一段，并用几句话告诉用户。用户若在侧栏继续和那条 Code 会话聊天，通知会推迟。Code 会话若再也不回到空闲，就不会投递。策略拦不住仍然调用 `wait` 的模型。

## 测试

包测试覆盖 execute 在 Code 空闲前返回、一直停到 Computer Use 调用方空闲、提示词仍在队列时等待 running→idle、调用方销毁时丢掉监视、缺少活的 Code agent 时跳过，以及拒绝同一 id 上的替换调用方。它们还钉住新的策略和描述句子。computer-use snapshot 的 header pin 会刷新 `system-prompt.expected.md` 与 `tool-schemas.expected.json`；click 循环 JSONL 不变，因为该 overlay 桩掉了 `sessionController`。
