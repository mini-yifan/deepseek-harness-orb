# Agent Note: Computer Use 单击修饰键

Status: implemented

[English](2026-09-19-computer-use-click-modifiers.md) | 中文

## 问题

Computer Use 能单击，但不能 Shift-click 或 Cmd-click。没有 bash 路径可用的文件选择器需要这些和弦才能多选。分开的按住/松开修饰键工具会在模型忘掉、回合中止、或压缩丢掉按住状态时，把键留在按下。

## 决策

`click` 接受可选 `modifiers`：`shift`、`cmd`/`command`/`meta`/`win`/`windows`/`super`、`option`/`alt`，以及 `control`/`ctrl`。execute 在 HID 之前拒绝任何其他 token，包括字母和 `fn`。省略或 `[]` 是普通单击。同一家族的重复 token 保留第一个。

macOS 只发一次 osascript：修饰键 keyDown，带同样 CGEvent flags 的 `clickAt` 鼠标事件，然后修饰键 keyUp。工具结果在有修饰键时写出它们。政策要求模型用后续每次 `click` 加上 `shift` 或 `cmd` 来多选，不要跨调用按住修饰键。[实验性 Computer Use](2026-09-13-experimental-computer-use.zh.md) 仍拥有插件。[Computer Use 的 macOS HID 发送](../bug-fix/2026-09-13-computer-use-macos-hid.zh.md) 拥有 JXA 发送。

## 考虑过的替代方案

**按住和松开两个工具。** 模型可能忘了松开。keyDown 之后若 abort、超时或 osascript 被杀掉，修饰键会卡在未沙箱的真实桌面上。overlay 遮蔽是按次的，因此按住的键会活过点击穿透。

**本轮给 `drag` 也加修饰键。** Option-拖复制是真实需求，但这次缺口是多选单击。

**同一次调用里多点 click。** 第一次点击导致滚动或重排时，后面的点会过期。按次带修饰键的 click 让每次单击都有自己的截图。

## 影响

只在修饰键跨观察一直按住时才显示额外 chrome 的应用，仍然无法那样驱动。带修饰键的单击若在 keyDown 之后失败，仍可能卡到匹配的 keyUp，时长限于那一次 osascript，与 `hotkey` 相同。

## 测试

包测试钉住允许列表、别名、字母/`fn` 在假 HID 之前被拒绝、结果文本、省略/`[]` 的普通单击、政策句子，以及生成的 JXA `clickWithModifiers`（带标志的鼠标事件再 keyUp）。Headless snapshot sidecar 钉住 `click` schema 和政策句子。
