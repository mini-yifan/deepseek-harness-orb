# Agent Note: Computer Use 瞬时窗口观察

Status: implemented

[English](2026-09-16-computer-use-transient-window-observation.md) | 中文

## 问题

[Computer Use 焦点窗口观察](2026-09-16-computer-use-focused-window-observation.zh.md) 只截跳过 overlay 后的一扇 layer-0 窗口。macOS 菜单、组合框列表和弹出层通常是另一扇 CGWindow：本机上 NSPopUpButton 菜单是 layer 101、与所有者同一 PID，并且常常伸到该窗口下方。`screencapture -l` 和 ScreenCaptureKit 的 `desktopIndependentWindow` 只记录所有者的 backing store，模型看到的仍是关闭态控件，会反复点击，却看不到列表。系统设置里的默认浏览器弹出层属于这一类；Excel 筛选、浏览器建议和右键菜单也是。

## 决策

观察仍从跳过 overlay 后的 layer-0 所有者开始。[焦点窗口观察](2026-09-16-computer-use-focused-window-observation.zh.md) 仍拥有该选取、`list_apps` / `open_app`，以及没有弹出层时的按窗口 id 捕获。本笔记拥有把打开的菜单并进同一张截图，并把 0–1000 映射到并集。

`inspectForeground` 仍取剩余 layer-0 窗口里第一扇两边都至少 64pt 的。然后收集屏幕上的窗口：不是 overlay id、不是 Dock/菜单栏/状态栏 layer 20/24/25、不是 Dock/控制中心/通知中心/墙纸所有者、且 alpha 不是 0。同一 PID 且 layer 为 3、8、19、101、102 的窗口会并进来，不套 64pt 下限。另一 PID 只在 layer 101 且边框与所有者外扩 48pt 后相交时并入。不在同一 `NSScreen` 上的瞬时窗口会跳过。`ScreenInfo.bounds` 变成并集；`transientWindowIds` 列出这些弹出层 id。现有的 `mapNormalizedToGlobal` 按 `bounds` 映射，伸到所有者下方的菜单仍可点。

`transientWindowIds` 为空时，捕获仍是 `screencapture -l -o` 或 helper `--window=` / `desktopIndependentWindow`。非空时，捕获是并集矩形：没有 overlay id 时用整屏 `screencapture` 再加 `sips --cropOffset` 裁切（本 OS 上 `screencapture -R` 会报 "could not create image from rect"），有 overlay id 时用 helper `--region=`，`SCContentFilter(display:excludingWindows:)` 加上 `sourceRect`。设置了 overlay id 时没有 `screencapture -R` 回退。helper 仍在 ScreenCaptureKit 之前于主 actor 以 `.prohibited` 启动 `NSApplication`。

POLICY 写明附加图像含该窗口上打开的菜单和弹出层，仍不含 Dock、菜单栏、其他应用和其他显示器。

本轮不加辅助功能 `click_element`、只截菜单的观察、按窗口合成，也不加整桌面回退。

## 考虑过的替代方案

**让弹出层成为唯一观察。** 下一张截图会是一小块菜单，没有父级控件。列表外的点击在那张图里没有坐标。

**用 `desktopIndependentWindow` 逐个合成弹出层。** 之后还得重建 z-order、阴影和光标。屏幕区域截图已经是用户看见的像素。

**始终裁所有者窗口的显示器矩形。** 落在该矩形内的菜单会进图，但伸到窗口下方的列表仍会被裁掉，而且重叠的其他应用会进入每一次截图。

**CLI 并集用 `screencapture -R`。** 本 OS 上它返回 `could not create image from rect`。无 overlay 的并集改为整屏 `screencapture` 再用 `sips` 裁切。

**用 AX `click_element` 点菜单项。** 画图、画布工具和游戏仍然需要截图。本轮保留视觉，只加宽光栅。

## 影响

区域截图可能带上与并集重叠的其他应用。overlay id 仍会省略悬浮球。若菜单根本不出现在 `CGWindowList` 里又伸到所有者外面，仍然看不见。同一 PID、同一屏幕上的浮动调色板会把截图变大。

## 测试

包测试钉住 inspect JSON 的 `transients` 落到 `ScreenInfo.transientWindowIds` 与并集 `bounds`、该列表为空时的 `screencapture -l`、非空时的整屏 `screencapture` 加 `sips` 裁切、有 overlay id 时 helper `--window=` 与 `--region=` 且无 `screencapture` 回退、AppKit 主 actor 初始化、helper `--region=` / `excludingWindows` / `sourceRect` 源码钉、inspect 脚本里的 layer 101，以及 POLICY 的菜单句。人工编写的 [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) 系统提示钉住该 POLICY 行。
