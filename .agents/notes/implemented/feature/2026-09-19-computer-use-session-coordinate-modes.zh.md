# Agent Note: Overlay 会话上的 Computer Use 千分比与像素坐标模式

Status: implemented

[English](2026-09-19-computer-use-session-coordinate-modes.md) | 中文

## 问题

Computer Use 的 click、type、scroll、drag、long-press 的 `position` 是已附加的最前窗口截图上的 0–1000 比例。Host 把两轴独立映射到该窗口的逻辑边框，再发送 HID。该空间由 [Computer Use 0–1000 比例坐标](../bug-fix/2026-09-15-computer-use-fraction-coordinates.zh.md) 拥有。POLICY、首帧通知、工具 `position` 描述和 `<coordinate_space>0-1000</coordinate_space>` 已经要求模型把 `x`、`y` 编成截图比例 × 1000（水平中心 `x` 是 500，不是像素列），并且不要发送原始像素。[图片句柄省略请求预览像素](../bug-fix/2026-09-15-omit-request-preview-handle-dimensions.zh.md) 隐去预览 `WxHpx`，避免那些数字看起来像点击空间。

部分视觉模型仍会发出截图量级的整数，例如在约 1470 宽的窗口上发 `[754, 155]`。Host 把它当成 75.4% / 15.5%。在又宽又矮的截图上，落点会明显偏右、略偏上——用户在 GLM 类路由上报告的系统性点偏，DeepSeek 上有时也有。千问、豆包类路由更常直接发 0–1000。这种点偏经常是**坐标编码**问题，不是看不见控件：错点几次，或显式做 ÷ 宽 × 1000 之后，同一模型就能点中。只加提示词能减轻、但不能消灭第一下编码错误。Overlay Computer Use 必须再提供一种编码：已附加截图上的像素。

## 决策

只保留 **一个** Computer Use 插件和现有的十三套 GUI 工具。同一种几何比例（已附加截图上的位置，再 × 窗口逻辑尺寸）提供两种编码。切换编码只能通过新建 overlay 对话。每条对话一辈子使用它创建时的那种编码。

该控件是 Desktop overlay 产品。Headless、Web 和其他 Computer Use 组合在未另加 Config 显式选择之前，继续只用 0–1000。[实验性 Computer Use](2026-09-13-experimental-computer-use.zh.md) 仍拥有工具、首帧附加和 HID。[Desktop 悬浮球](2026-09-14-desktop-floating-orb.zh.md) 仍拥有 overlay 会话创建、History、New 和 `floating-session.json`。

### 同一种截图比例的两种编码

两种模式都计算 `logicalX = window.x + fractionX × window.width`（`y` 同理）。差别只在模型怎么写 `fractionX`：

| 模式 | 模型发出的 `position` `x` | Host 还原的比例 | 信封 |
|---|---|---|---|
| 千分比（默认） | 0–1000 | `x / 1000` | 只留 `<coordinate_space>0-1000</coordinate_space>`；不带像素尺寸 |
| 像素 | **本次观察已附加图片**上的列 | `x / attachedWidth` | 像素空间，外加该附件的 `WxH` |

像素钉在**那一次**观察里附上的栅格，不要钉捕获 backing 像素、Retina 倍率、逻辑窗口点，或之后的请求预览缩放。信封里的 `WxH` 和映射时的除数必须是 `saveImage` 之后 `ObservedScreen.image.width/height` 的同一对。该会话每一次请求的 POLICY、首帧通知、`position` 描述、点击结果文案、校验和映射，必须描述同一种编码。`drag` 的起点和终点使用同一种编码。没有附件栅格时像素点击失败，不会静默退回 1000。

### Overlay 默认值与会话合同

有两件可以不一致的事实：

1. **新建 overlay Computer Use 会话的 Desktop 默认值** — 右键菜单项和主窗口设置页开关反映的就是它。默认千分比打开。写在 `millifraction-coordinates.json`，与其他 orb 偏好同级，不要写进 `floating-session.json`。
2. **每条会话的合同** — 空白新建时记下的 `'computer-use/coordinate-mode'`，必须能从会话日志重建，因为它对模型可见。不可忽略，也不是插件通知：旧读端若跳过通知，仍会按 0–1000 映射。某次请求的 POLICY、工具 schema、信封、校验和映射，读的是**这条会话**的合同，不是当前 Desktop 默认值。普通事件词表增长不提升 `SESSION_FORMAT_VERSION`。

用户关掉千分比之后，继续一条旧的千分比会话，仍走千分比。该开关之后的新建 overlay 会话（包括 overlay New）走像素。History 认领不得用 Desktop 默认值重盖会话合同：已有编码事件或 `session/end-seed` 的日志不动。Overlay 创建、历史接上和新建已经会以 `saveAsDefault: false` 重套已存的 overlay **模型**（[悬浮球 Agent 模型菜单](2026-09-17-orb-agent-model-menus.zh.md)）；坐标编码不是那个字段，也不得搭 `selectModel` 的便车。

`tool:computer-use` 系统提示分节是 `(context) =>` 函数。没有 agent 的组装保持千分比。有 agent 时跟随那条会话的日志。像素模式下五个带 `position` 的工具在 assemble waterfall 上改写；`dsh-tools.wireSchemas` 保持千分比。

Desktop Host 插件 `computer-use-orb-coordinate-mode` 发布可选的 `ctx.orbCoordinateMode`。Computer Use 只在空白新建时 `ctx.get('orbCoordinateMode')`。实验包不导入 desktop-host。Electron 在 Host 就绪以及用户确认更改默认值之后，经 Host IPC 推送 `orb-coordinate-mode`。

### 右键菜单与设置页开关

在 overlay 原生菜单里放一项与划词工具条同级的开关，紧挨划词项下方、仍在退出上方。不要放进悬浮球 Agent 设置或后台 Agent 设置，也不要放进每个模型的二级菜单。划词那一行由 [Desktop 划词工具条](2026-09-16-desktop-selection-toolbar.zh.md) 拥有；本项是兄弟，不是子项。后台 Agent 设置走 `code_agent`，没有桌面点击空间。

[Desktop 悬浮球设置](2026-09-18-desktop-orb-settings.zh.md) 页在划词卡片之后增加一张兄弟卡片：标题、说明，以及绑到同一 Desktop 默认值的 `Switch`（打开表示千分比开）。文案由 orb 设置页的 locale 词典拥有。Windows 上整页悬浮球设置保持禁用，包括这个开关。

原生菜单文案跟划词一样（当前状态，动作为取反）：千分比开着 → **Disable millifraction coordinates** / **关闭千分比坐标**；千分比关着 → **Enable millifraction coordinates** / **打开千分比坐标**。菜单标签和设置页开关都显示「下一局新建 overlay 会话」的 Desktop 默认值，不是当前打开对话的读数。

两处控件都不得改写已打开会话的合同。打开任一控件都弹出确认（由 shell 弹出原生对话框）。取消不写入、不创建，设置页开关不得先闪。确认后走菜单和设置页**共用**的一条应用路径：写入取反后的默认值，推送 Host，并发送 overlay New IPC，让 `floating.js` 调用现有的 `createOrbSession()`。设置页渲染进程不调用 `session.create`。上一条会话留在 `dsh_orb` 工作区。

### 共用工具，分叉合同

不再挂一份 Computer Use 插件，也不再注册一个 `click`。工具名、互斥、再截图和 HID 仍是一条路径。HID 内部仍消费千分比。`execute` 读会话合同，把 `position` 变成截图比例，然后复用现有的全局映射。

## 考虑过的替代方案

**只加强千分比提示词，不提供第二种编码。** 已上线的 POLICY 已经写明 × 1000 并禁止像素。GLM 类路由在宽截图上第一下仍会系统性点偏。产品需要像素编码，而不是更长的提示词。

**全局下拉或设置页开关改写正在进行的会话。** 在已有记录里替换 POLICY，会把两种编码混进同一份日志。选定的产品改为新建会话。

**设置页开关像划词那样立即持久化，然后再确认。** 那会在用户同意新对话之前就改掉默认值，取消时还得撤回一次写入。必须先确认，再写入并创建。

**在每个模型的二级菜单里、思考强度旁边放 checkbox。** 切换编码仍然要新开对话，绑到目录里的某一行就等于选 GLM 时强制新开。Electron 禁止既是 checkbox 又带 `submenu` 的项；没有思考模式的模型今天是叶子，那样会迫使所有 overlay 模型都变成嵌套菜单。编码是 overlay 会话合同，不是模型属性。

**两套 Computer Use 插件（千分比包对像素包）。** 会复制十三套工具、首帧附加、同意门槛和 macOS 后端。卸下一份再装另一份并不是会话切换。一个插件、两种编码才是组合方式。

**Host 自动判断：看起来像像素的数就当像素。** `[754, 155]` 在两套空间里都合法。自动判断做不到。会话合同必须显式。

**像素模式却不展示 `WxH`。** 捕获像素、附件像素、请求预览像素和逻辑点不是同一套数。这些尺寸在**不是**点击空间时展示，正是当初改成 0–1000 的原因；像素模式下已附加图的 `WxH` **就是**点击空间，必须出现在观察上。

**History 认领时像重套 overlay 模型那样套上 Desktop 默认值。** 那会把旧的千分比对话改写成像素（或反过来），破坏本产品规则。

**用插件通知当会话合同。** 通知是 `user/message`；旧读端不会拒读，仍会按 0–1000 映射。专用 required-on-read 事件才是合同。

## 影响

像素模式把栅格重新交给模型。若请求投影在附加之后再次缩放，模型计数的网格仍可能和信封 `WxH` 不一致；千分比正是为了避开这个缺口，像素模式只帮得上原生 token 贴着附件栅格走的模型。用户关掉千分比后在**新**会话里再选千问类模型，会一直按像素点，直到再次打开千分比并确认又一个新对话。菜单文案和设置页开关显示的是默认值，不是打开的记录，History 聚焦时容易看错；确认文案必须写明当前对话不变。Headless/Web snapshot 保持千分比。不认识 `'computer-use/coordinate-mode'` 的读端会拒读该日志。

## 测试

Computer Use 包测试钉住千分比映射、像素 `x/attachedWidth × bounds`、越界像素拒绝、缺失栅格失败、千分比信封不含 `WxH`、像素信封含附件 `WxH`、同一进程两条会话组装出不同 POLICY 与 `position` 文案、空白新建打戳对比 `session/end-seed` 认领，以及 drag 起终点同一编码。现有 tools/pre-step/envelope 钉仍为千分比。

Desktop 测试钉住菜单顺序（划词下方、退出上方）、确认取消（JSON 不变、不 create、设置页开关不闪）、确认成功（JSON 取反、Host 推送、overlay `createOrbSession`）、History 认领仍 `selectModel` 但不重盖编码，以及设置页卡片与 Windows 禁用。Headless [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) 保持千分比。像素模型可见文本由包测试在拥有方本地钉死。
