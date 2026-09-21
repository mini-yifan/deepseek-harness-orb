# Agent Note: Desktop selection toolbar in the Orb process

Status: implemented

[English](2026-09-21-desktop-selection-in-process-identity.md) | 中文

## 问题

打包后的 DeepSeek Orb 从 `app.asar.unpacked` 派生 `macos-selection`。该 Mach-O 是第二个 adhoc CDHash（`Identifier=macos-selection`），因此授权给带图标 `.app` 的辅助功能并不信任 helper。helper 发出 `untrusted` 且从不安装 `NSEvent.addGlobalMonitorForEvents`，搜索 / 翻译 / 发给 Agent 就不会出现。无证书包按 CDHash 记 TCC；两个二进制合并不了一行。[Desktop ScreenCaptureKit 进 Orb 进程](../architecture/2026-09-20-desktop-sck-in-process-identity.zh.md) 已经为截屏记录过这种分裂。

## 决策

Darwin 划词监视跑在 Electron 主进程里。Desktop 编译 `libmacos-selection.dylib` 和 `macos-selection-napi.node`，与 ScreenCaptureKit 插件一起 unpack，并通过 `napi_create_threadsafe_function` 投递 NDJSON 行。因此 `AXIsProcessTrusted` 和全局鼠标监视使用 Orb 的辅助功能行。`@_cdecl` 库入口禁止调用 `setActivationPolicy(.prohibited)`，否则会把 Orb 从 Dock 拿掉。[桌面划词工具条](../feature/2026-09-16-desktop-selection-toolbar.zh.md) 仍拥有工具条 UI、提示词和开关。

装上进程内监视的包之后，完全退出（Cmd-Q）再打开。系统设置里残留的 `macos-selection` exec 行是旧 helper，可以用「−」删掉。

## 考虑过的替代方案

**继续派生 unpacked helper。** 现场 `/Applications/DeepSeek Orb.app` 已经派生了 unpacked 二进制；helper 仍然听不见，因为它的 CDHash 不是 Orb 那一行。

**给 helper 套上应用 bundle id。** 无证书 adhoc TCC 仍按 CDHash 记，两个 Mach-O 合并不了。

**经 koffi 加载 helper。** 划词工具条打包已经否决过 Electron 加 koffi；asar、签名和原生模块策略要求编译好的 N-API 插件，与排除 overlay 的截屏同一条路径。

## 影响

签名和未签名的 Desktop 包为划词工具条只向带图标的 DeepSeek Orb 要辅助功能。打包的 Electron 不再随包提供可执行文件 `lib/macos-selection`。库路径从不改 Electron 的 activation policy。

## 测试

Swift 源码的 `@main` 仍含 CLI 的 `setActivationPolicy(.prohibited)`；cdecl 启动路径不含。Desktop 测试钉住 N-API threadsafe function、仅 Darwin 加载、缺 addon 时跳过，以及 electron-builder 对 `.node` 与 dylib 的 `asarUnpack`。
