# Agent Note: Computer Use 的 wait 与 long_wait

Status: implemented

[English](2026-09-15-computer-use-wait-and-long-wait.md) | 中文

## 问题

Computer Use 的 `wait` 接受自由的 `wait_seconds` 数字，默认 1，并由 Config `maxWaitSeconds` 5 封顶。模型把该上限当成应当等待的时长，普通加载也经常选 3–5 秒。对转圈来说，再截一张图等 1 秒已经很长；空等 5 秒更糟。下载、安装和屏幕上的生成仍然需要几十秒到一分钟。[实验性 Computer Use](2026-09-13-experimental-computer-use.zh.md) 仍拥有插件与互斥 GUI 路径。

## 决策

`wait` 不接受参数，始终暂停 1 秒再重新截屏。最新截图仍显示加载、转圈或控件尚未出现时使用。click 与 open 的结果里已经有新截图，除非那张图仍在加载，否则不要紧跟着 `wait`。

`long_wait` 要求 `wait_seconds` 为 `{10, 30, 60, 120}`。缺省或不在枚举内会响亮失败。只给看得见的长任务（下载、安装器、导出、窗口内生成）。选能覆盖剩余进度的最小分档；120 只在截图已经写明还要几分钟时使用。10 秒下限是产品不变量，用来把普通刷新留在 `wait`。两个工具都是互斥 GUI 回截图；`delay()` 仍尊重 abort。

删除 `maxWaitSeconds`。1 秒暂停与四档秒数不是 cordis Config。策略与 `code_agent` 要求模型不要用 `wait`、`long_wait` 或 bash sleep 去轮询 Code 会话。

## 考虑过的替代方案

**一个可填 1–120 秒的 `wait`。** 模型会贴着连续区间的上限。4–5 秒的习惯会变成 60 和 120。

**再做一个 5–15 秒的中间工具。** 那会重新打开「保险等待」。空隙用重复 `wait` 或付出 `long_wait` 10 秒来填。

**CoView `page_loading` 的像素 settle。** 本包在 HID/open 之后只保留固定的 `postActionWaitMs`（默认 600），紧挨在截取像素之前，不做像素差 stall。

**`long_wait` 默认 60 或可省略秒数。** 省略必须失败。默认 60 会再次鼓励贴上限。

## 影响

Computer Use 目录是十三个互斥 GUI 工具加 `code_agent`。普通加载不能再要 3–5 秒。还剩 8 秒的下载要么连调 `wait`，要么用 `long_wait` 10 多等一会。overlay-guard 不变：这两个工具都不发 HID。

## 测试

包测试 spy `delay`，因此 execute 不会按墙钟睡眠。覆盖 `wait` 始终 1 秒、`long_wait` 每一档、缺省与非法 `wait_seconds`、纯文本拒绝、互斥模式、`presentCall`、GUI schema 列表，以及删除 `maxWaitSeconds`。人工编写的 [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) header pin 会刷新 `system-prompt.expected.md` 与 `tool-schemas.expected.json`。
