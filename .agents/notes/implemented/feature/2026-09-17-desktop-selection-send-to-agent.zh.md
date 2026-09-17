# Agent Note: Desktop selection Send to Agent

Status: implemented

[English](2026-09-17-desktop-selection-send-to-agent.md) | 中文

## 问题

macOS 用户在其他应用里划选文字后，希望用自己的指令让悬浮球 agent 处理这段话。Agent 讲解会立刻排队一条固定的「Explain this text」Computer Use 轮次，跳过首帧截图，并且从不使用 overlay 输入框。用户随后在同一个输入框打字时，会把第三个工具条按钮当成不同于普通发送的特例。

## 决策

划词工具条的第三个按钮是 **发给 Agent**。搜索和翻译不变。[桌面划词工具条](2026-09-16-desktop-selection-toolbar.zh.md) 仍拥有 helper、几何、Bing 和翻译。发给 Agent 会隐藏工具条、展开 overlay、聚焦它，并通过 `selectionAttach` 推送完整选区。overlay 把该字符串存为 composer 状态，并在输入胶囊朝向对话记录的一侧紧贴显示一行 chip（`expand-up` 在上方，`expand-down` 在下方）。溢出用 CSS 省略号；存储的字符串保持完整。关闭控件会清掉 chip。overlay 铬件（新建、历史、Access）不会。再次发给 Agent 会替换这段话。

composer 的第一次回车把 `instruction + "\n\n" + selection` 走普通 overlay `session/prompt` 路径，然后清掉 chip。该用户消息不以 `Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.` 开头，因此 Computer Use 保留首帧捕获，并可以调用 GUI 工具或 `code_agent`。之后的回车发送是普通 composer 文本。空指令不会发送。

翻译仍用 `showInactive` 和 overlay 拥有的 `activate` 抑制来恢复划词所在前台应用。发给 Agent 使用同一段 2 秒的主窗口抑制，聚焦 overlay，并且不 `activate-pid`。`floatingSetExpanded` 只在该翻译恢复前台窗口仍有效时恢复前台应用；attach 会清掉它，避免展开抢走键盘。chip 存在时像会话运行或提问中一样阻止自动折叠。overlay 不会自动固定。

## 考虑过的替代方案

**继续立刻讲解。** 固定讲解提示词带不上「润色」或「精简」，而且跳过首帧会让第三个按钮不同于其他每一次 composer 发送。

**chip 在后续发送中保留。** 这段话会悄悄加到每条后续前面。第一次回车就清掉，符合一次性附件。

**像翻译一样跳过首帧捕获。** 用户在同一个输入框里打字，期望这是普通任务并带截图。翻译前导仍然是跳过信号。

**自动固定 overlay。** 固定会改用户并未点击的铬件。chip 存在时阻止折叠，足够用来打字。

**把 chip 持久化到 `floating-session.json`。** 重启不应复活来自其他应用的一段话。renderer 内存即可。

## 影响

翻译仍是唯一会省略首帧的工具条动作。改发给 Agent 的拼接方式，或聚焦 overlay 却不清 restore-front，会丢掉选区、抢走前一个应用，或弹出主窗口。工具条出现仍需要辅助功能。

## 测试

Desktop 测试覆盖 attach IPC 对比翻译 prompt、发给 Agent 不 `activate-pid`、展开时聚焦 overlay 且不 restore-front、chip 省略号 CSS 以及 expand-up/down 位置、新建对话保留 chip、关闭、第一次回车拼接指令与完整选区后清除、第二次回车不再带这段话。Computer Use 前导跳过测试不变，仍属于翻译。
