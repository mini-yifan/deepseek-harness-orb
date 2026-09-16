# Agent Note: Computer Use 应用窗口观察

Status: implemented

[English](2026-09-16-computer-use-app-window-observation.md) | 中文

## 问题

[Computer Use 焦点窗口观察](2026-09-16-computer-use-focused-window-observation.zh.md) 选出跳过 overlay 后的一扇 layer-0 窗口。额外 CGWindow 只通过相交、Helper 名称前缀或 layer 101 并入。微信菜单能匹配。WPS「新建」和其他同应用面板常常不能：它们可能是不同 PID 或名称，并且坐在所有者旁边。按窗口 id 捕获（`screencapture -l` / ScreenCaptureKit `desktopIndependentWindow`）只记录该所有者的 backing store，这些面板永远进不了图。

## 决策

[焦点窗口观察](2026-09-16-computer-use-focused-window-observation.zh.md) 仍拥有选哪个应用：跳过 overlay 后剩余 layer-0 窗口里第一扇两边都至少 64pt 的。本笔记拥有镜头里有什么。

从所有者 PID 起，`inspectForeground` 用 JXA 经 `NSWorkspace.runningApplications` 建立应用族：同一 PID；`localizedName` 相同或 `A` / `A …`；`bundleIdentifier` 相同或一方是另一方加 `.`（`com.kingsoft.wpsoffice.mac` / `com.kingsoft.wpsoffice.mac.promecefpluginhost`）。它并上该族每一扇同一 `NSScreen`、alpha > 0、非 chrome 的窗口。Chrome 仍是 Dock 与菜单栏 layer 20/24 以及 `CHROME_WINDOW_OWNERS`。族窗口并入时不做 48pt 相交测试。无亲缘 PID 的 layer 101 加 48pt pad 只作为 WindowServer 菜单回退。`transientWindowIds` 列出额外窗口 id，可为空；`x`/`y`/`width`/`height` 始终是并集。

捕获始终是该并集矩形：CLI 整屏 `screencapture` 加 `sips` 裁切；Desktop helper `--region=` 加 `excludingWindows`。观察不走按窗口 id 捕获。overlay id 仍会省略悬浮球。与并集重叠的其他应用可以出现；这是接受的。

先等待再 inspect 与 `withGuiTurn` 仍由 [Computer Use 右键菜单观察](../bug-fix/2026-09-16-computer-use-context-menu-observation.zh.md) 拥有。区域 helper 机制仍由 [Computer Use 瞬时窗口观察](2026-09-16-computer-use-transient-window-observation.zh.md) 拥有。

POLICY 写明附加图像是这块显示器上的最前应用，含该应用打开的菜单、弹出层和面板，仍不含 Dock、菜单栏、并集重叠以外的其他应用，以及其他显示器。

本轮不加辅助功能 `click_element`、整桌面回退，也不按窗口合成。

## 考虑过的替代方案

**继续用相交和 Helper 名称前缀猜测瞬时窗口。** 坐在所有者旁边的同应用面板仍进不了图。

**族里只有一扇窗时仍按窗口 id 捕获。** 所有者 backing store 仍会漏掉屏幕上的兄弟窗口，两条捕获路径对屏幕像素也不一致。

**整桌面截图。** Dock、其他应用和其他显示器会回到图像里。

**把屏幕上每一扇 layer-0 窗口都当家族成员。** 无关的重叠应用会并进每一张截图。

## 影响

区域截图会带上与并集矩形重叠的任何其他应用。另一块 `NSScreen` 上的兄弟窗口会被省略。根本不出现在 `CGWindowList` 里的窗口仍然看不见。很大的同 bundle 调色板会把截图变大。

## 测试

包测试钉住 inspect JXA 的家族 pid / bundle 前缀并入、族窗口不加 pad、无亲缘 layer 101 仍加 pad、单窗口捕获走 `screencapture` 加 `sips` 或 helper `--region=`（不是 `-l` / `--window=`）、有 overlay id 时 `--region=` 加 exclude，以及 POLICY 的应用句。[瞬时窗口观察](2026-09-16-computer-use-transient-window-observation.zh.md) 钉住 helper `--region=` / `excludingWindows` / `sourceRect`。[右键菜单观察](../bug-fix/2026-09-16-computer-use-context-menu-observation.zh.md) 钉住先等待再 inspect 与 `withGuiTurn`。人工编写的 [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) 系统提示钉住该 POLICY 行。
