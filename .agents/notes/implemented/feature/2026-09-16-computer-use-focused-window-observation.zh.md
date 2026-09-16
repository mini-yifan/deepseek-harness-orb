# Agent Note: Computer Use 焦点窗口观察

Status: implemented

[English](2026-09-16-computer-use-focused-window-observation.md) | 中文

## 问题

Computer Use 会捕获每块已连接显示器，并把 `click` / `drag` / `input_text` 映射为该显示器 `NSScreen` 逻辑边界上的 0–1000 比例。因此模型在同一张图里会同时看到 Dock、菜单栏、其他应用、空白壁纸，以及目标 UI 所在窗口。DeepSeek 仍会把这张光栅缩进约 169 万像素的请求预览，视觉预算大部分花在下一步根本不会点到的像素上。瞄准于是变成整块显示器上的比例：一个窗口里的小控件在 0–1000 空间里只有几十个单位，即便模型已经认出控件，第一次点击也经常系统性偏左或偏下。

在截图上叠坐标网格，以及发送原生 1920×1080 光栅，都不足以作为可发布的修复。Anthropic 的 computer-use 指南对 overlay 网格给出同样结论。在普通按钮上看起来更准的产品（Codex、Qoder、Trae）在能读到时走辅助功能树；能在画图里涂鸦的产品仍然用视觉，但它们截的是**目标窗口**，坐标落在那张图上，再用应用级激活/打开把另一个应用带到前台——并不要求模型在整桌面截图里去点 Dock。

插件已经知道 Desktop overlay 下面那扇 layer-0 窗口是谁（`inspectForeground` 会写 `<frontmost_app>`），但捕获忽略该窗口的 id 和边框，仍然按显示器截。一旦改成只截窗口，Dock 和其他应用会从画面里消失，除非运行时能按名称激活或启动应用，模型就没有视觉手段切换程序。

## 决策

Computer Use 观察是跳过 overlay 之后、最前面的那一扇应用窗口。现有的前台独占 HID 循环不变：agent（智能体）仍然在用户的 Mac 上发送真实 `CGEvent`，运行期间人不得使用这台 Mac。改变的只是模型被允许看见的内容。

[实验性 Computer Use 插件](2026-09-13-experimental-computer-use.zh.md) 仍拥有 GUI 工具、首帧附加和同意门槛。[Computer Use 0–1000 比例坐标](../bug-fix/2026-09-15-computer-use-fraction-coordinates.zh.md) 仍拥有**已附加截图**上的 0–1000 空间。[Computer Use 观察前台元数据](2026-09-15-computer-use-observation-foreground.zh.md) 仍拥有 `<frontmost_app>` / `<frontmost_folder>` / `<focus_note>`（本轮增加可选的 `<frontmost_window>`）。[Desktop overlay-guard IPC](../architecture/2026-09-14-desktop-overlay-guard.zh.md) 仍拥有从捕获中省略悬浮球。

`inspectForeground` 在跳过 `activeCaptureExcludeWindowIds()` 之后遍历屏幕上的 layer-0 `CGWindow`，并返回 `windowId`、全局逻辑边框、可选 `windowTitle`，以及所在 `NSScreen` 的 backing scale。JXA 把 `CGWindowListCopyWindowInfo` 绑定为返回 `id`，这样 `ObjC.deepUnwrap` 才是数组；不绑定的话 unwrap 不是数组，遍历找不到窗口，模型就只有 focus 标签、没有截图。边长小于 64pt 的剩余窗口会被跳过，这样标题栏尺寸的 chrome 不会变成截图。`listScreens` 就是这一块面：0 或 1 条 `ScreenInfo`（`index` 恒为 0；`bounds` 是所有者，或该应用屏幕上的窗口并集）。`wrapDesktopBackend` 把 `listScreens` 放进 `withCapture`，这样 exclude id 是活的；否则空 exclude 列表会把悬浮球当成最前窗口。

哪扇窗是所有者仍由本笔记拥有。镜头里有什么由 [Computer Use 应用窗口观察](2026-09-16-computer-use-app-window-observation.zh.md) 拥有：该应用族窗口的屏幕并集，始终按显示器矩形裁切。执行时通过现有的 `mapNormalizedToGlobal` 把 0–1000 映射到当前观察边框。`screen_index` 对本面是 0。`maxScreens` 已删除。

`list_apps` 列出 `activationPolicy === regular` 的显示名。`open_app` 接受显示名或 bundle id：已运行则 `NSRunningApplication.activateWithOptions_(NSApplicationActivateIgnoringOtherApps)`；否则 `/usr/bin/open -a` / `-b` 启动。短等的裸 `open -a` 不是已运行应用的激活路径。匹配不唯一或激活失败时，工具结果用文本说明，并带上同样的 focus 标签，不附桌面全景。

当跳过 overlay 后没有 layer-0 所有者时，观察是 `<frontmost_app>none</frontmost_app>` 加上 `<focus_note>`，不附截图。POLICY 告诉模型：只信任附加的最前应用截图；应用不对就调用 `list_apps` / `open_app`；不要点 Dock。大窗仍压到现有约 169 万像素的请求预算；小窗保持捕获尺寸。

本轮不加辅助功能 `click_element`、后台虚拟光标、overlay 瞄准网格，也不加 Windows/Linux 生产后端。

## 考虑过的替代方案

**保留整桌面捕获并加网格。** 在 DeepSeek Flash 上的实机评估对真实密集 UI 的提升不足以发布，而且 overlay 线会挡住控件。Anthropic 认为 overlay 网格不可靠。偏点经常是「点到了桌面的错误区域」，网格修不了。

**发送原生 1920×1080 显示器像素。** DeepSeek 请求路径仍然有视觉 token 上限（约 169 万像素，再加 1024 token 上限）。多出来的编码像素不会变成多出来的可见细节，坐标空间仍是整块显示器。

**只观察 AX（不要截图）。** 在画图里涂鸦、画布工具和游戏没有可用于笔划的 AX 节点。Codex 对这些任务仍然截图并 `drag`。本轮保留截图，只是收窄到最前窗口。

**Codex 式后台 PID 事件和虚拟光标。** 所要求的产品保持前台独占：真实指针会动，运行期间人不得使用这台 Mac。窗口观察不需要后台投递。

**对最前窗口边框做显示器矩形裁。** 接到 `screencapture -R` 更快，但该矩形里任何重叠窗口或桌面 chrome 都会进图，而映射却假定目标窗口拥有每一个像素。

**inspect 失败时静默回退到整桌面。** 那会在同一次会话里混用两套坐标空间，并再次教模型去点 Dock 图标。

## 影响

模型看不见其他窗口，因此不能去点属于另一进程的对话框。被捕获应用上打开的菜单和同应用面板由 [Computer Use 应用窗口观察](2026-09-16-computer-use-app-window-observation.zh.md) 纳入。另一应用的窗口的恢复路径是激活/打开再重新截取。

若焦点落在每边至少 64pt 的检视器面板上，且它是剩余 layer-0 窗口里最前面的一扇，它会变成整次观察。模型随后可能去激活同一应用的主文档窗口；`open_app` 按名称瞄准该应用，而不能只瞄准「当前焦点是什么」。

应用不对的首帧会多花一轮。这被接受：用户可能开着微信却要求用画图。

前台独占控制没有改变，在共享 Mac 上仍然不安全。收窄截图并不会在运行期间给人一根能用的指针。

## 测试

包测试钉住单窗口信封、空最前无全景、窗口边框映射、`list_apps` / `open_app`、激活失败文本，以及 `ObjC.bindFunction` 让 inspect 脚本把 `CGWindowListCopyWindowInfo` unwrap 成数组。overlay-guard 测试在 `withCapture` 里跑 `listScreens`，在 `withInput` 里跑 `openApp`。捕获 argv 与家族并集匹配由 [Computer Use 应用窗口观察](2026-09-16-computer-use-app-window-observation.zh.md) 拥有。人工编写的 [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) 场景钉住 POLICY、首帧窗口通知、click 信封、假后端单窗口 fixture 和新工具 schema。
