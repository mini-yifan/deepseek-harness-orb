# Agent Note：Windows 悬浮球

Status: implemented

[English](2026-09-22-windows-floating-orb.md) | 中文

## 问题

悬浮球、划词工具条和 Computer Use 桌面后端只在 macOS 上创建。Windows Desktop 仍是单主窗口，Computer Use 在执行时抛错。球页面、`dsh_orb` 会话和工具协议已经是共用的。

## 决策

Windows 在 Host 就绪后创建同一套 overlay。窗口是无边框透明置顶窗口，置顶级别为 screen-saver。它不用 `type: 'panel'` 或 `setVisibleOnAllWorkspaces`，这两项只属于 Darwin。`app.setActivationPolicy` 与 `app.dock.show()` 仍只在 macOS 调用。Linux 仍然不创建球。设置写入在 macOS 和 Windows 上允许。

Computer Use 的捕获或 HID 区间打开时，Windows 对球和划词条设置 `contentProtection`，让遵守 `WDA_EXCLUDEFROMCAPTURE` 的捕获 API 省略它们。动作后的截图跑在 HID 区间里。macOS 仍用 ScreenCaptureKit 窗口 id 排除这些窗口。HID 期间的点击穿透不变。

`createPlatformBackend('win32')` 返回 Windows 后端。捕获、前台选择和 `SendInput` 共用每监视器物理像素。[Windows Computer Use 每监视器坐标](../architecture/2026-09-23-windows-computer-use-per-monitor-dpi.zh.md) 负责这项决定。`open_in_finder` 打开资源管理器。前台进程完整性高于本进程时，输入会抛错，而不是被静默丢掉。测试注入 `WindowsDesktopOps`，不发送真实输入。

划词工具条保持原来的控制器和页面。Windows 在 Electron 主进程安装 `WH_MOUSE_LL` 与 `WH_KEYBOARD_LL`，并用 UI Automation 读取焦点处的选区。事件与 Darwin helper 相同。钩子安装失败时记录日志并仍然发出 `ready`，球仍可使用。

## 考虑过的替代方案

**在 Windows 上复用 `type: 'panel'`。** Electron 在那里不提供这种窗口类型，也没有 Space 可见性。screen-saver 置顶窗口是可用的对应物。

**把 Computer Use 拆成 Service Definition 和 Windows provider 包。** 这个包仍然是一个实验插件。多一个后端文件本身不需要新包。

**捕获时隐藏球，而不是设置显示亲和性。** 隐藏会让 overlay 闪一下。显示亲和性让用户仍能看见它。

## 后果

关掉主窗口后，球会一直留到退出，Windows 与 macOS 相同，因为 `window-all-closed` 只在所有窗口都关闭后触发。虚拟桌面上是否一直可见遵循 Windows 置顶行为，不是 macOS 的 Space 行为。未提权进程不能点击或输入提权窗口。Linux 上的 Computer Use 仍抛出 `computer-use: desktop control is implemented only on macOS and Windows`。

## 测试

`apps/desktop/tests/main-startup.spec.ts` 创建 Win32 overlay 和划词条，检查 screen-saver 置顶，并检查 content protection 在捕获期间和 HID 期间打开。Linux 仍然两者都不创建。`windows.spec.ts` 通过注入的操作驱动后端。`windows-selection.spec.ts` 在不安装钩子的情况下检查选区事件。
