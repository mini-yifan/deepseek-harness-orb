# Agent Note: Desktop Orb TCC 门与 DeepSeek Orb 展示名

Status: implemented

[English](2026-09-20-desktop-orb-tcc-gate.md) | 中文

## 问题

Computer Use 在 macOS 上截屏需要屏幕录制，发送 HID 需要辅助功能。访达自动化只在某一轮真正与访达对话时才需要。插件在这些调用失败时点名对应 TCC，且不弹授权框，因此 overlay 发送可以开始一轮、随即失败。打包后 Electron 的 `app.name` 曾是 DeepSeek Harness，那是仓库、CLI 和主窗口 Web UI 的品牌，不是系统设置里列出的桌面壳身份。

## 决策

第一次 `setExpanded(true)` 时，若本进程尚未获得屏幕录制或辅助功能，Desktop overlay 用一层盖住展开的 `#panel`（对话记录加输入区）。每一行打开系统设置对应页（`Privacy_ScreenCapture` / `Privacy_Accessibility`）。稍后和关闭控件只收起该层；下一次展开或发送若仍缺权限会再出现。overlay 回车和划词工具条翻译只有两项都是 `granted` 才调用 `session/prompt`；输入框草稿保留。两项探针都报已授权时，该层自动消失，无需确认。已经两项都授权的用户永远看不到它。Windows 与 Linux 视 TCC 为不适用，不出该层。

每项状态是 `missing`、`granted` 或 `needsRelaunch`。用户打开过仍未开启的设置页后，overlay 提供退出并重新打开（`app.relaunch()` 再 `app.quit()`）。关掉主窗口不等于退出。`app` 激活与 overlay 获得焦点会重新推送快照。文案插值 `app.name`：打包后是 DeepSeek Orb，`pnpm run start:desktop` 下是 Electron。

访达自动化不进这层。`mac.extendInfo.NSAppleEventsUsageDescription` 让第一次 `tell application "Finder"` 能弹出系统提示。

打包 `productName` 是 DeepSeek Orb。`appId` 不变，已有 TCC 授权继续有效。仓库、CLI、`dsh` 和主窗口 Web UI 文案仍是 DeepSeek Harness。设置 → 悬浮球在千分比卡片后显示 macOS 状态卡；Windows 保持该页禁用且不显示该卡。

Computer Use 插件仍然不弹授权框。捕获或 HID 执行时若缺权限，仍点名 TCC。[实验性 Computer Use](2026-09-13-experimental-computer-use.zh.md) 拥有这些执行失败。

## 考虑过的替代方案

**用第二扇 Electron 窗口做权限教程。** 那会多一块始终置顶的 chrome 要从截屏里排除，并且不挡在 overlay 发送路径上。

**在 `tool-computer-use` 第一次 GUI 执行时弹窗。** 插件跑在 Host Node 子进程里，不能以签名应用身份打开系统设置，而且 overlay 发送仍会开始一轮、在第一次截屏或点击时失败。

**把访达自动化放进这两行。** 系统已在第一次 AppleEvent 时弹出。提前询问会要一项多数会话用不到的权限。

**改展示名时一并改 `appId`。** 屏幕录制与辅助功能授权按 bundle id 键控；新 id 在系统设置里会像另一个应用。

**永久跳过。** 之后发送只能硬拦且没有剩余 UI，或者在工具所需权限缺失时启动 Computer Use。

## 影响

未授权的 overlay 发送不能开始 Computer Use 回合。两项都授予并完全退出再打开的用户不会再看到该层。从源码启动时，系统设置里的身份是 Electron，不是 DeepSeek Orb。访达仍在第一次使用时弹出。Web `--patch` 组合没有 overlay 覆盖层。

## 测试

Desktop overlay 测试覆盖首次展开出门、已授权跳过、发送被拦且无 `session/prompt` 且草稿保留、稍后后再发送再出门、`needsRelaunch` 的退出并重新打开，以及已授权推送隐藏该层。主进程测试映射 TCC 探针、打开设置 URL，并在 activate 与 overlay 焦点时重推。设置测试渲染 macOS 卡片并调用 `openTcc`。打包测试钉住 `productName` DeepSeek Orb、`.app` / `.exe` 路径和 `NSAppleEventsUsageDescription`。Computer Use `macos.ts` 仍在执行失败时点名 TCC，且不弹窗。
