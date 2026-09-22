# Agent Note: Computer Use 后台职能

Status: implemented

[English](2026-09-22-computer-use-background-role.md) | 中文

## 问题

Computer Use 策略按产物点名（Word、PPT、调研报告），并要求 `code_agent` 之后结束本回合。以一次点击收尾的文件查找因此留在悬浮球上，由它自己跑 bash 和网页搜索。真的交出去时，标准编码 agent 把任务当成一个工程，并写成一份长报告。第二次搜索常常才落到要点，所以固定的调用次数划不出这一段。

## 决策

Computer Use 策略、preset 人设、`code_agent` 描述和工具结果要求模型自己决定每一段。可见 GUI，以及一次就能回答或供下一步点击使用的搜索或命令，留在本对话，包括模型判断能落到要点的第二次搜索。一段文件查找，以及用户要的文件、文档、表格或网站，交给 `code_agent`。最后一步是点击，不把前面的查找留在悬浮球上。

`code_agent` 返回后，只有不依赖后台结果的 GUI 动作可以在本轮继续。否则模型告诉用户后台 agent 正在运行并结束本回合。仍然不得用 `wait`、`long_wait` 或 bash sleep 轮询。[Computer Use 把 Code agent 完成通知停到空闲再投递](2026-09-15-computer-use-code-agent-completion.zh.md) 仍在两边都空闲后投递通知。收到通知后模型再决定一次：剩下的 GUI、同一 `session_id` 上的又一段，然后用几句话收束。它不复述长报告。

`session.create` 仍使用 `agentPreset: 'standard'`。`queuedTaskText` 把 `BACKGROUND_ROLE` 附在入队的用户消息后面。完成通知只引用模型写的任务。标准 preset 的人设不变。[Overlay Computer Use 后台调度](2026-09-17-orb-code-agent-dispatch.zh.md) 仍拥有无人值守应答；自由文本回答要求 Code agent 停下并交出现有的短结果。

## 考虑过的替代方案

**在 Computer Use 会话上拒绝第二条 bash 或第二次网页搜索。** 只有模型知道第二次搜索会落到要点。配额会截断这次搜索，并在提示词旁边再加一条执行器规则。

**把标准 preset 的人设改成必须短答。** 侧栏里每条编码会话都用这个 preset。悬浮球交出去的文件制作仍然需要这个 agent。

**为委派的查找另加一个短答 preset。** 文件制作和查找就会拆到两个 preset。这一次仍用一条标准会话，把职能写在入队消息上。

## 影响

没有调用次数限制。模型仍可能在悬浮球上继续翻找，或在被告知停下之后写成一份报告。自由文本回答只在 Code agent 发起提问时生效。用户要的文件仍然要花标准 agent 所需的时间。

## 测试

`code-agent.spec.ts` 钉住 `POLICY` 和工具描述里的分段句子，入队 `queuedTaskText(task)`，并检查完成通知引用模型任务且不含 `BACKGROUND_ROLE`。computer-use snapshot 的 header pin 带有策略段和 `code_agent` schema。
