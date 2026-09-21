# Agent Note: Desktop 在 Orb 进程内做 ScreenCaptureKit

Status: implemented

[English](2026-09-20-desktop-sck-in-process-identity.md) | 中文

## 问题

打包后的 DeepSeek Orb 会列出两行屏幕录制：带图标的 `.app`（Electron）和绿色 exec（`macos-sck-capture`）。overlay TCC 探测的是 Electron 进程。排除 overlay 的捕获派生 helper，因此只打开带图标那行仍会以另一个 TCC 客户失败 ScreenCaptureKit。无证书 adhoc 包按 cdhash 区分 TCC，两个 Mach-O 无法合成一行。签名包里 helper 仍在 `signIgnore` 的 `dsh/` 下，identifier 也不是 `ai.deepseek.orb`，照样多出一行。

## 决策

排除 overlay 的 ScreenCaptureKit 跑在 Electron 主进程里。Host 协议 8 承载带确认的 `sck-capture` / `sck-capture-ack`。`ComputerUseOverlayGuard.captureExcludedRegion` 是 Desktop 路径；CLI 仍 exec `macos-sck-capture`，授权落在 Terminal 或调用方上。Swift 捕获共用一份：CLI `@main` 入口仍把 `NSApplication` activation policy 设为 `.prohibited`；`@_cdecl` 库入口禁止改它，否则会把 Orb 从 Dock 拿掉。Desktop 编译 ABI 稳定的 N-API `.node` 和 `libmacos-sck-capture.dylib`，与 `macos-selection-napi.node` 一起 unpack，并通过 `napi_create_async_work` 调用捕获，避免 MainActor 跳转与 Electron 主线程死锁。[桌面 overlay-guard IPC](2026-09-14-desktop-overlay-guard.zh.md) 拥有遮蔽区间、exclude id 和观察框彩带。

装上在进程内捕获的包后，完全退出（Cmd-Q）再打开。系统设置里残留的 exec 行是旧 helper，可用「−」删掉。

## 考虑过的替代方案

**先隐藏 overlay 再走 `desktopCapturer`。** 每次截屏都会让球和观察框彩带闪掉。

**给 helper 换 bundle id，或签成同一 Developer ID Team。** 仍然是第二个 Mach-O。无证书 adhoc TCC 按 cdhash，两个二进制合并不了。

**在 Electron 里用 koffi 加载 helper。** 划词工具条打包已经否决过 Electron 加 koffi；asar、签名和原生模块策略要求编译好的 N-API 插件。

## 后果

签名包和无证书包的排除 overlay 捕获都只向带图标的 DeepSeek Orb 要屏幕录制。CLI Computer Use 仍把 helper 列在 Terminal 下。`dsh/` extra 仍携带 CLI helper。库路径从不改 Electron 的 activation policy。

## 测试

helper 源码仍含 CLI 的 `setActivationPolicy(.prohibited)`；cdecl 入口以 `startCliApplication: false` 调用 capture，不改 activation policy。省略 `captureExcludedRegion` 时 `macos.ts` 派生 helper，提供该方法时不派生。Host 与 Electron 测试钉住 sck-capture 成功、失败确认且 Host 不 fatal、超时、中止，以及协议 8。打包测试钉住 `.node` 与 dylib 和 `macos-selection-napi.node` 一起 asarUnpack。
