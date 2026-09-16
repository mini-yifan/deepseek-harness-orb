# Agent Note: Computer Use 焦点窗口观察

Status: proposed

[English](2026-09-16-computer-use-focused-window-observation.md) | 中文

## 问题

Computer Use 今天会捕获每块已连接显示器，并把 `click` / `drag` / `input_text` 映射为该显示器 `NSScreen` 逻辑边界上的 0–1000 比例。因此模型在同一张图里会同时看到 Dock、菜单栏、其他应用、空白壁纸，以及目标 UI 所在窗口。DeepSeek 仍会把这张光栅缩进约 169 万像素的请求预览，视觉预算大部分花在下一步根本不会点到的像素上。瞄准于是变成整块显示器上的比例：一个窗口里的小控件在 0–1000 空间里只有几十个单位，即便模型已经认出控件，第一次点击也经常系统性偏左或偏下。

在截图上叠坐标网格，以及发送原生 1920×1080 光栅，都不足以作为可发布的修复。Anthropic 的 computer-use 指南对 overlay 网格给出同样结论。在普通按钮上看起来更准的产品（Codex、Qoder、Trae）在能读到时走辅助功能树；能在画图里涂鸦的产品仍然用视觉，但它们截的是**目标窗口**，坐标落在那张图上，再用应用级激活/打开把另一个应用带到前台——并不要求模型在整桌面截图里去点 Dock。

当前插件已经知道 Desktop overlay 下面那扇 layer-0 窗口是谁（`inspectForeground` 会写 `<frontmost_app>`），但捕获忽略该窗口的 id 和边框，仍然按显示器截。一旦改成只截窗口，Dock 和其他应用会从画面里消失，除非运行时能按名称激活或启动应用，模型就没有视觉手段切换程序。

## 提案

把 Computer Use 观察从「每块已连接显示器」改成「跳过 overlay 之后、最前面的那一扇应用窗口」。保持现有的前台独占 HID 循环：agent（智能体）仍然在用户的 Mac 上发送真实 `CGEvent`，运行期间人不得使用这台 Mac。改变的只是模型被允许看见的内容。

本笔记是这一刀的产品与实现约定。[实验性 Computer Use 插件](../../implemented/feature/2026-09-13-experimental-computer-use.zh.md) 仍拥有 GUI 工具、首帧附加和同意门槛。[Computer Use 0–1000 比例坐标](../../implemented/bug-fix/2026-09-15-computer-use-fraction-coordinates.zh.md) 仍拥有**已附加截图**上的 0–1000 空间。[Computer Use 观察前台元数据](../../implemented/feature/2026-09-15-computer-use-observation-foreground.zh.md) 仍拥有 `<frontmost_app>` / `<frontmost_folder>` / `<focus_note>`。[Desktop overlay-guard IPC](../../implemented/architecture/2026-09-14-desktop-overlay-guard.zh.md) 仍拥有从捕获中省略悬浮球。

### 目标循环

1. 用户发送一条 Computer Use 消息。模型运行之前，宿主捕获当前最前的可操作窗口（跳过 overlay id），并附上这一张图以及现有的前台信封。
2. 之后每一次 GUI 工具结果都在**重新截取时**捕获当时最前的窗口，而不是记住上一步的窗口。
3. 模型只看见该窗口的像素。它收不到其他显示器、Dock、菜单栏或旁系应用。
4. 若 `<frontmost_app>` 或画面不是用户要的应用，模型不去找 Dock。它调用应用级激活/打开工具（找到正在运行的进程，或启动该应用）。系统把该应用带到前台。
5. 下一次观察就是新的最前窗口。点击和拖拽是那张新图上的 0–1000，经该窗口的全局边框映射。
6. 输入仍是真桌面上的前台 `CGEvent`。这一刀不加入 Codex 式后台虚拟光标，也不加入让用户指针保持空闲的按 PID 投递。

工作示例：微信在前台，用户要求在画图里画一只猫。首帧是微信窗口。模型激活或打开画图。重新截取得到画图窗口。随后的 `drag` 笔划留在该窗口的 0–1000 空间内。

### 保持不变的部分

- 仍在 `agent/pre-step` 附加首帧，每个 GUI 工具之后重新截取；仍然没有 observe 工具。
- 每次工具调用只做一次 GUI 动作；`postActionWaitMs` 之后再截。
- 可见截图上的 0–1000，x/y 独立缩放，忽略句柄上的像素尺寸。
- 检查时跳过 overlay 窗口 id，图像里也不包含它们。
- macOS 屏幕录制与辅助功能；其他平台生产路径仍然抛错。
- 运行期间人不得与 agent 共用指针。

### 捕获定义

「最前窗口」是跳过 `activeCaptureExcludeWindowIds()` 之后、第一扇屏幕上的 layer-0 `CGWindow`，与 `inspectForeground` 已经在走的 z-order 遍历相同。它不是辅助功能的焦点元素，也不是「用户消息里点名的那个应用」。

按窗口 id 捕获（或用 ScreenCaptureKit 的 `SCWindow` 过滤器），不要按显示器矩形裁。对 `kCGWindowBounds` 做显示器矩形裁会把重叠窗口和壁纸收进图里。去掉窗口阴影（`screencapture -o` 或等价裁剪）：阴影进了 PNG、却不在 `mapNormalizedToGlobal` 使用的边框里，会再次造成系统性点击偏移。

附加图像就是该窗口的内容。`screen_index` `0` 命名这一块唯一的观察面。`maxScreens` 不再表示「拼接多少块显示器」；后续可以再把同一应用的额外窗口（调色板、菜单）作为更多 index 附上，但这一刀只发布一扇窗口。

### 坐标映射

`mapNormalizedToGlobal` 必须使用被捕获窗口的全局逻辑边框，而不是 `NSScreen.frame`。`[0, 0]` 是附加图像的左上角；`[1000, 1000]` 是同一张图的右下角。HID 发送仍是全局 Quartz 点。若捕获像素与映射边框不一致（阴影、Retina 缩放、翻转坐标系），点击会偏，方式和信封曾泄漏请求预览像素时显示器空间映射偏点相同。

`ScreenInfo`（或改名为捕获面）必须带上窗口原点和尺寸供映射。一旦观察变成窗口范围，`listScreens` 作为「全部 NSScreen」就不再是执行时的正确列表：`requireScreen` 必须解析到最近一次观察的窗口边框，或在映射前立即重新读取边框。

### 切换最前应用

只观察窗口会让 Dock 从画面消失，因此仅靠 POLICY 写「点击目标窗口」不够。这一刀要给模型一种可见手段来：

- 列出本次 Computer Use 会话可以瞄准的正在运行的应用；
- 激活一个正在运行的应用（把它的前台窗口带到前面）；
- 在尚未运行时按 bundle id 或显示名启动应用。

`open_in_browser` 和 `open_in_finder` 仍用于 URL 和文件系统路径。它们不是通用应用切换器。激活/打开之后，工具等待 `postActionWaitMs` 并重新截取；新图就是新的最前窗口。POLICY 必须告诉模型：若截图是错误的应用，就激活或打开正确的那个；不要去点画面里没有的 chrome。

### 没有可操作窗口时的回退

当跳过 overlay 后没有 layer-0 所有者（点了桌面、Mission Control、空的 Space）时，保留 `<frontmost_app>none</frontmost_app>` 和 `<focus_note>`。这一刀不要把整块桌面光栅当作静默回退附上：那会重新教模型在显示器空间里瞄准。agent 通过激活/打开获得窗口。若激活/打开失败，工具结果用文本说明失败，并带上同样的回退标签，仍然不附整桌面全景。

### 当前代码对照

和包 README 一起读这些文件；它们就是本提案要替换的现行观察路径。

| 路径 | 今天做什么 | 这一刀改什么 |
|---|---|---|
| [`packages/experimental/tool-computer-use/README.zh.md`](../../../../packages/experimental/tool-computer-use/README.zh.md) | 显示器捕获、每屏 0–1000、十一个 GUI 工具 | 写明窗口观察、应用激活/打开，以及 Dock 不可见规则 |
| [`src/observe.ts`](../../../../packages/experimental/tool-computer-use/src/observe.ts) | `listScreens` → 捕获每块显示器；信封是 `screen_index` + `0-1000` | 捕获 inspect 得到的窗口；每次观察一块面 |
| [`src/macos.ts`](../../../../packages/experimental/tool-computer-use/src/macos.ts) | 对 `NSScreen` 边框做 `screencapture -R`；inspect 只返回 `appName` | 返回窗口 id + 边框；按窗口 id 捕获；设置了 overlay id 时用 SCK 窗口过滤 |
| [`src/macos-sck-capture.swift`](../../../../packages/experimental/tool-computer-use/src/macos-sck-capture.swift) | 显示器 `sourceRect` 减去 overlay 窗口 | 针对窗口的捕获，仍省略 overlay id |
| [`src/coordinates.ts`](../../../../packages/experimental/tool-computer-use/src/coordinates.ts) | 0–1000 × `screen.bounds`（显示器） | 0–1000 × 被捕获窗口边框 |
| [`src/backend.ts`](../../../../packages/experimental/tool-computer-use/src/backend.ts) | `ScreenInfo` 是显示器；`DesktopForeground` 是应用元数据 | 捕获面是窗口；前台元数据可以包含窗口标题 |
| [`src/plugin.ts`](../../../../packages/experimental/tool-computer-use/src/plugin.ts) | 首帧和重新截取调用 `observeDesktop`；工具带 `screen_index` | 附加时机不变；执行经该次观察的窗口映射 |
| [`src/policy.ts`](../../../../packages/experimental/tool-computer-use/src/policy.ts) | 只信任附加的桌面截图；出现 `<focus_note>` 时点击以聚焦 | 只信任最前窗口截图；应用不对时激活/打开 |
| [`src/overlay-guard.ts`](../../../../packages/experimental/tool-computer-use/src/overlay-guard.ts) | 遮蔽捕获/HID；把 overlay id 传入 inspect 和 SCK | 窗口捕获不应包含球；z-order 遍历仍跳过这些 id |

### 这一刀不做

- 辅助功能 `click_element` / 编号 AX 树（Codex 的按钮路径）。窗口观察仍是视觉 + `CGEvent`。
- 让人类指针保持空闲的后台 / 虚拟光标 Computer Use。
- Overlay 瞄准网格、letterbox 标尺，或强制 1920×1080 请求图像。
- 把菜单、sheet、浮动调色板拼进主窗口图像。它们是单独的 CGWindow；后续若需要，作为同一应用的额外观察面附上，而不是退回整桌面捕获。
- Windows/Linux 生产后端。

## 考虑过的替代方案

**保留整桌面捕获并加网格。** 在 DeepSeek Flash 上的实机评估对真实密集 UI 的提升不足以发布，而且 overlay 线会挡住控件。Anthropic 认为 overlay 网格不可靠。偏点经常是「点到了桌面的错误区域」，网格修不了。

**发送原生 1920×1080 显示器像素。** DeepSeek 请求路径仍然有视觉 token 上限（约 169 万像素，再加 1024 token 上限）。多出来的编码像素不会变成多出来的可见细节，坐标空间仍是整块显示器。

**只观察 AX（不要截图）。** 在画图里涂鸦、画布工具和游戏没有可用于笔划的 AX 节点。Codex 对这些任务仍然截图并 `drag`。这一刀保留截图，只是收窄到最前窗口。

**Codex 式后台 PID 事件和虚拟光标。** 所要求的产品保持前台独占：真实指针会动，运行期间人不得使用这台 Mac。窗口观察不需要后台投递。

**对最前窗口边框做显示器矩形裁。** 接到今天的 `screencapture -R` 更快，但该矩形里任何重叠窗口或桌面 chrome 都会进图，而映射却假定目标窗口拥有每一个像素。

**inspect 失败时静默回退到整桌面。** 那会在同一次会话里混用两套坐标空间，并再次教模型去点 Dock 图标。

## 验收标准

- 首次用户回合以及每一个 GUI 工具结果只附加一张「跳过 overlay 后最前的 layer-0 窗口」截图，外加现有的前台标签。模型可见内容里没有显示器全景。
- `click` / `drag` / `input_text` / `scroll` / `long_press` 经该窗口的全局边框映射 0–1000。附加图像里的控件，点击落在其可见框内，而不是落在显示器上同一比例的位置。
- PNG 与映射边框之间的阴影、缩放、翻转坐标不一致视为产品缺陷，而不是模型误差。
- 最前应用不是任务目标时，模型可以在看不见 Dock 的情况下激活正在运行的应用或启动它；下一张图是该应用最前的窗口。
- overlay chrome 不出现在窗口截图里。`<frontmost_app>` 仍跳过 overlay id，并且当 Desktop 主窗口是 z-order 中下一扇时可点名它。
- 空的最前状态使用 `<focus_note>`，不附加整桌面图像。
- 包测试和已编写的 [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) 场景钉住单窗口信封、激活/打开和 POLICY。假后端返回一张窗口尺寸的 fixture（测试前置数据），而不是每块显示器一张图。
- Desktop overlay-guard 仍遮蔽 HID。存在 overlay id 时 Darwin 上的窗口捕获仍可用（SCK 窗口过滤或等价实现），且没有会把球重新带进画面的 `screencapture` 回退。

## 风险

模型看不见其他窗口，因此不能去点属于另一进程的对话框，也不能去点叠在被捕获窗口之上、本身是另一扇 CGWindow 的菜单。恢复路径是激活/打开再重新截取；部分 UI 需要后续再捕获瞬时窗口。

若焦点落在很小的检视器面板上，它会变成整次观察。模型随后可能去激活同一应用的主文档窗口；激活工具必须能瞄准该应用，而不能只瞄准「当前焦点是什么」。

应用不对的首帧会多花一轮。这被接受：用户可能开着微信却要求用画图。

前台独占控制没有改变，在共享 Mac 上仍然不安全。收窄截图并不会在运行期间给人一根能用的指针。
