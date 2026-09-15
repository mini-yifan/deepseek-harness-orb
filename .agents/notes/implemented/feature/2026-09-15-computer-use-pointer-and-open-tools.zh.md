# Agent Note: Computer Use 指针与打开工具

Status: implemented

[English](2026-09-15-computer-use-pointer-and-open-tools.md) | 中文

## 问题

Computer Use preset 已经能点击、输入、滚动、热键与等待，但不能长按、拖拽、打开用户可见浏览器，或打开已知文件/文件夹。模型会 OCR 桌面图标、用 `web_fetch` 代替弹出窗口，或用 `bash` `open` 顶替。[实验性 Computer Use](2026-09-13-experimental-computer-use.zh.md) 仍拥有插件、preset 与同意门槛。

## 决策

另外四个互斥 GUI 工具沿用现有「一轮一动作、动作后回截图」路径，并在纯文本路由上于 execute 失败。

`long_press` 接受 `screen_index`、0–1000 的 `position`，以及可选 `duration_seconds`（默认 3，含 1–10）。该上下限是 HID 安全不变量，不是 cordis Config。macOS 发送 `longPressAt`（左键按下、休眠、抬起）。

`drag` 接受起止屏幕序号与 0–1000 坐标。允许跨屏。macOS 发送 `dragFromTo`：移动、左键按下、十次 LeftMouseDragged（类型 6）步进、抬起。步数留在 [`HID_RUNTIME`](../../../../packages/experimental/tool-computer-use/src/macos.ts) 内。

`open_in_browser` 与 `open_in_finder` 通过 `/usr/bin/open` 启动，不走 HID。省略 `url` 则启动默认 HTTP 处理器（LaunchServices 查找后 `open -b`）。给出的 URL 必须是 http(s)；缺 scheme 时补 `https://`；拒绝 userinfo；路径与查询中的 CJK 必须是明文，不得使用 `%E5...` / `%E8...` 这类多字节百分号编码。这是用户可见浏览器。`web_search` / `web_fetch` 仍是给模型的文本。

`open_in_finder` 展开 `~`、做 `realpath`，并拒绝 CoView 风格前缀（`/System`、`/private`、`/etc`、`/var`、`/usr`、`/sbin`、`/bin`、`/dev`、`/proc`、`/sys`）。省略 `path` 则打开 `~/Desktop`。目录在 Finder 打开。文件用默认应用打开；`reveal_only` 为 true 时走 `open -R`。目录忽略 `reveal_only`。路径不存在则大声失败。结果文本带上解析后的路径，避免模型 OCR。没有目录预览列表。

[`wrapDesktopBackend`](../../../../packages/experimental/tool-computer-use/src/overlay-guard.ts) 用 `withInput` 遮蔽 `longPress` 与 `drag`。`openInBrowser` 与 `openInFinder` 不包，因为它们不发送 HID。回截图仍走 `withCapture`。

策略告诉模型：已知路径 → `open_in_finder`；可见站点 → `open_in_browser`；滑块、窗口移动、文件拖拽 → `drag`；按住 → `long_press`；不要用 `bash` `open` 或 `web_fetch` 顶替。

## 考虑过的替代方案

**用 `bash` `open` 作为打开路径。** 这会让启动离开 GUI 互斥模式、跳过回截图，并绕过 URL 与路径检查。

**拆成 `open_file` / `open_folder`。** 一个带可选 `path` 与 `reveal_only` 的工具匹配模型已认识的 CoView 调用，省略路径打开桌面也只需一份 schema。

**在 `open_in_finder` 上做目录预览列表。** 那是 `manage_files` 的工作。本刀只返回解析路径和一张截图。

**HID 点击 Dock 或桌面图标。** 打开已知路径或 URL 不需要找像素，overlay chrome 还会挡。

**本刀加入 `launch_app`、`capture_screen` 与 `manage_files`。** 那些是另一些 CoView 工具。观察已经在首帧和每次 GUI 结果里；启动应用与文件管理仍延期。

**用 cordis Config 配置按住时长或拖拽步数。** 1–10 的按住上下限是 HID 安全不变量。拖拽步数是 `HID_RUNTIME` 里的实现常量。

## 影响

Computer Use 目录是十个互斥 GUI 工具加 `code_agent`。`open_*` 可以弹出 overlay 不会遮蔽的窗口。路径黑名单含 `/private`，因此 macOS 上 `realpath` 后的 `/tmp` 被禁止。CJK 百分号编码会在 execute 以面向模型的诊断失败。

## 测试

包测试覆盖 execute/render、互斥模式、schema 名称、非法时长/URL/路径、纯文本拒绝、含 `longPressAt` / `dragFromTo` 的 JXA、URL、默认浏览器、桌面、文件与 `open -R` 的 `/usr/bin/open` argv、overlay 包裹分流、unsupported 方法，以及路径/URL 助手。人工编写的 [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) header pin 会刷新 `system-prompt.expected.md` 与 `tool-schemas.expected.json`。回放仍使用固定 PNG。
