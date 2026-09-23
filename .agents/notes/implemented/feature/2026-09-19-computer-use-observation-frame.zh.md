# Agent Note: Computer Use 观察框彩带

Status: implemented

[English](2026-09-19-computer-use-observation-frame.md) | 中文

## 问题

Computer Use 用真实指针驱动跳过 overlay 后最前应用的屏幕窗口并集。看着这台 Mac 的人没有 chrome 标明 Agent 能看见、能点击的矩形。把描边画进截图会进入模型图像并改变瞄准。捕获期间隐藏 Desktop chrome 已经会让悬浮球闪一下。

## 决策

Desktop 在当前 `ScreenInfo.bounds`（捕获裁切与 0–1000 点击映射的同一并集矩形）四边画一条静态、点击穿透的空心彩带。彩带只给人看：只要它可见，ScreenCaptureKit 省略列表就带上它的 CGWindowID，与悬浮球相同。它从不出现在面向模型的图像里。CLI 与 Web 组合没有 Electron overlay，也不显示它。

`wrapDesktopBackend` 在每次 `listScreens` 之后等待 `ComputerUseOverlayGuard.setObservationFrame`（第一块屏幕的 bounds，列表为空则为 `null`）。当这次 `listScreens` 的 signal 已经中止时，包装层用 `null` 且不带该 signal 隐藏，而不是显示 bounds。Desktop Host 协议 7 在 overlay-guard 传输上增加带确认的 `observation-frame` / `observation-frame-ack`。`setObservationFrame` 从不对已中止的 signal 发送 SHOW：它发送 `null`，不带该已中止 signal 等待这次隐藏确认，然后拒绝。一次仍有效的 SHOW 在 turn signal 上武装 `{ once: true }` abort，使 Stop 立即隐藏；recapture 复用同一个控制器。隐藏的 abort 拒绝等待，且不发送第二次隐藏。Electron 复用一扇 `BrowserWindow`（`dsh-app://shell/observation-frame.html`），把 bounds 外扩 36pt，让 8px 静态青到紫描边与 drop-shadow 光晕贴在区域外侧，与工作区求交而不平移 overlay，并按剩余外扩设置各边 CSS padding，使内沿留在观察矩形上。贴齐工作区的边把 8px 描边画在内侧。窗口始终 `setIgnoreMouseEvents(true, { forward: true })`、`setContentBounds`，并 `showInactive`。彩带使用 `setAlwaysOnTop(true, 'floating', 0)`；悬浮 overlay 与划词工具条使用相对层级 `1`，每次显示彩带后对 overlay 调用 `moveTop`，球保持在彩带之上。在 Windows 上 Host 发来的 bounds 是物理像素，`showObservationFrame` 在摆放前用 `screen.screenToDipRect` 转换。彩带窗口设置 `contentProtection`，使 GDI 捕获省略它，球保持在 screen-saver 置顶级别、位于彩带之上。`applyComputerUse` 在 `session/event` `turn/end` 时隐藏。Host 停止也会隐藏。`withInput` 内的嵌套 `withCapture` 仍发送 capture begin/end，好让新出现的 frame id 进入下一次 exclude 列表，且不切换 HID 点击穿透；[桌面 overlay-guard IPC](../architecture/2026-09-14-desktop-overlay-guard.zh.md) 拥有该遮蔽。

## 考虑过的替代方案

**把彩带画进截图。** 模型会看见并非可点控件的 chrome，而坐标假定观察并集拥有每一个像素。

**Host → Electron 的 bounds 发送后不等待确认。** 下一次 overlay-guard begin 会与窗口显示竞态，并把彩带拍进图。

**捕获期间隐藏彩带。** 用户会看见它闪灭，与隐藏悬浮球是同一失败。

**辅助功能 overlay 或画进目标应用。** 那需要额外 TCC，不能按 Desktop 窗口 id 从 ScreenCaptureKit 排除，并且画进 Computer Use 并不拥有的应用。

**只跟随 owner 窗口，不跟随家族并集。** Agent 可以点击并集内任何位置，包括同应用面板，彩带会标出比点击空间更小的区域。

## 影响

贴齐工作区的观察边把 8px 描边画在该边内侧，使内沿留在观察矩形上；会离开工作区的光晕被裁掉。与并集重叠的其他应用落在彩带内侧；这与截图一致。并发 Computer Use 会话共用一扇 frame 窗（最后一次 bounds 生效）。空的首帧保持隐藏，直到 `listScreens` 返回矩形。用户 Stop（`session/cancel`）中止 turn signal 并隐藏彩带，不等待 Computer Use 协作排空；`keepInbox` 的后续 turn 可能再次 SHOW。

## 测试

插件测试钉住 `wrapDesktopBackend` 对 bounds 与 `null` 调用 `setObservationFrame`、inner `listScreens` 之后中止时隐藏且不留下 bounds、没有 sender 时直通，以及已完成与已中止 turn 的 `turn/end` 清除。Host 测试钉住 observation-frame 的发送/确认/超时/中止、已中止 SHOW 发送隐藏、SHOW 确认等待被中止时的补偿隐藏、SHOW 确认后 turn signal 中止时隐藏、隐藏的 abort 不发送第二次 frame 事件、没有 sender 时直通，以及 `withInput` 内嵌套 `withCapture` 刷新 exclude id。Electron 测试钉住 Windows 物理像素到 DIP 的转换与彩带 content protection、外扩与工作区求交、按边 glow/stroke 使内沿留在观察矩形上（贴齐边内侧 8px）、`showObservationFrame` 写入 CSS 变量、始终点击穿透、可见 frame id 进入 `overlayWindowExcludeIds`、隐藏时省略、CSS 无 `animation`、8px 描边加 drop-shadow、悬浮 overlay 在彩带之上、协议 7 不匹配，以及 Host 停止时隐藏。
