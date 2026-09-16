# Agent Note: Computer Use 截图导出

Status: implemented

[English](2026-09-15-computer-use-screenshot.md) | 中文

## 问题

用户会要求 Computer Use 截一张能粘贴或留下来的图。观察已经把屏幕附给模型，因此 observe 工具会浪费一轮。持久附件在 `DSH_HOME` 下，从不把桌面路径告诉模型。[实验性 Computer Use](2026-09-13-experimental-computer-use.zh.md) 仍拥有插件与互斥 GUI 路径。

## 决策

`screenshot` 是互斥 GUI 导出。它按与观察相同的 overlay-skip 管道捕获当前最前窗口，把该栅格写到用户桌面，文件名采用 macOS 风格的 `Screenshot YYYY-MM-DD at HH.MM.SS`，把它复制到系统剪贴板，并在工具结果文本里返回这些路径，外加常规观察图片。缺写或空写会响亮失败。工具不接受参数。刷新加载仍用 1 秒的 `wait`。

策略要求模型不要只为看窗口而调用 `screenshot`。`copyImageToClipboard` 不是 HID，overlay-guard 不包它。剪贴板是替换，不是恢复。[Computer Use 焦点窗口观察](2026-09-16-computer-use-focused-window-observation.zh.md) 拥有窗口捕获。

## 考虑过的替代方案

**只给视觉用的 observe/screenshot 工具。** 观察已经在首次用户回合和每次 GUI 结果里。

**只存进附件库。** 模型仍然没有用户可见路径，也无法粘贴。

**可选目标路径。** 桌面就是 Finder 默认，和省略的 `open_in_finder` 一样。路径参数会重新打开打开路径黑名单。

**恢复先前剪贴板。** 用户要的就是图片在剪贴板上。`input_text` 粘贴后仍只恢复先前的字符串。

## 影响

Computer Use 目录是十三个互斥 GUI 工具加 `code_agent`。窗口捕获写一个文件并复制该图。`screenshot` 之后再 `input_text` 会用字符串盖掉那张图。overlay-guard 的 HID 路径不变。

## 测试

包测试写到临时 home 的 Desktop，插件测试 spy `writeDesktopScreenshots`，并记录假的 `copyImageToClipboard`。macOS 测试为 NSPasteboard JXA 注入 command runner。人工编写的 [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) header pin 会刷新 `system-prompt.expected.md` 与 `tool-schemas.expected.json`。
