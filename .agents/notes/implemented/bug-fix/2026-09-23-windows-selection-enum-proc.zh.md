# Agent Note: Windows 选区枚举回调只注册一次

Status: implemented

[English](2026-09-23-windows-selection-enum-proc.md) | 中文

## 问题

Computer Use 的 `input` begin 会调用 `restoreLastFrontApp()`，进而调用 `activateWindowsPid`。该函数每次恢复都对 `DshSelEnumProc` 调用 `koffi.proto`。Koffi 在进程内保留原型名，因此第二次调用抛出 `Duplicate type name 'DshSelEnumProc'`。overlay-guard 把任何抛错都当成 Host 失败，Desktop 就在会话已经在跑的时候显示启动失败页。

## 决策

`DshSelEnumProc` 以及使用它的 Win32 函数每个进程只创建一次。`activateWindowsPid` 重复使用它们。overlay-guard 的 `input` begin 在恢复失败时写日志，仍返回 overlay 窗口 id，因此 Win32 错误不会停掉 Host。

## 考虑过的替代方案

**抓住这个抛错，但把 `koffi.proto` 留在 `activateWindowsPid` 里。** 第二次恢复不再弄垮 Host，同时也不再把上一个应用带到前台。

**每次调用使用不同的原型名。** Koffi 会把每个名字留到进程退出。一次很长的 Computer Use 会话会不断分配回调类型。

## 后果

之后的 GUI 动作仍可以再次恢复上一个应用。恢复仍然失败时写入 Desktop 日志，遮蔽继续。macOS 的选区激活不变。

## 测试

`apps/desktop/tests/windows-selection.spec.ts` 在 Windows 上对 `activateWindowsPid(0)` 调用两次。这个 pid 对不上任何窗口，因此测试不改变前台。
