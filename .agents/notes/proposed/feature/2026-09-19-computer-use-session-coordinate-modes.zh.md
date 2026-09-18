# Agent Note: Overlay 会话上的 Computer Use 千分比与像素坐标模式

Status: proposed

[English](2026-09-19-computer-use-session-coordinate-modes.md) | 中文

## 问题

Computer Use 的 click、type、scroll、drag、long-press 的 `position` 是已附加的最前窗口截图上的 0–1000 比例。Host 把两轴独立映射到该窗口的逻辑边框，再发送 HID。该空间由 [Computer Use 0–1000 比例坐标](../../implemented/bug-fix/2026-09-15-computer-use-fraction-coordinates.zh.md) 拥有。POLICY、首帧通知、工具 `position` 描述和 `<coordinate_space>0-1000</coordinate_space>` 已经要求模型把 `x`、`y` 编成截图比例 × 1000（水平中心 `x` 是 500，不是像素列），并且不要发送原始像素。[图片句柄省略请求预览像素](../../implemented/bug-fix/2026-09-15-omit-request-preview-handle-dimensions.zh.md) 隐去预览 `WxHpx`，避免那些数字看起来像点击空间。

部分视觉模型仍会发出截图量级的整数，例如在约 1470 宽的窗口上发 `[754, 155]`。Host 把它当成 75.4% / 15.5%。在又宽又矮的截图上，落点会明显偏右、略偏上——用户在 GLM 类路由上报告的系统性点偏，DeepSeek 上有时也有。千问、豆包类路由更常直接发 0–1000。这种点偏经常是**坐标编码**问题，不是看不见控件：错点几次，或显式做 ÷ 宽 × 1000 之后，同一模型就能点中。只加提示词能减轻、但不能消灭第一下编码错误。Overlay Computer Use 必须再提供一种编码：已附加截图上的像素。

## 提案

只保留 **一个** Computer Use 插件和现有的十三套 GUI 工具。同一种几何比例（已附加截图上的位置，再 × 窗口逻辑尺寸）提供两种编码。切换编码只能通过新建 overlay 对话。每条对话一辈子使用它创建时的那种编码。

该控件是 Desktop overlay 产品。Headless、Web 和其他 Computer Use 组合在未另加 Config 显式选择之前，继续只用 0–1000。[实验性 Computer Use](../../implemented/feature/2026-09-13-experimental-computer-use.zh.md) 仍拥有工具、首帧附加和 HID。[Desktop 悬浮球](../../implemented/feature/2026-09-14-desktop-floating-orb.zh.md) 仍拥有 overlay 会话创建、History、New 和 `floating-session.json`。

### 同一种截图比例的两种编码

两种模式都计算 `logicalX = window.x + fractionX × window.width`（`y` 同理）。差别只在模型怎么写 `fractionX`：

| 模式 | 模型发出的 `position` `x` | Host 还原的比例 | 信封 |
|---|---|---|---|
| 千分比（默认） | 0–1000 | `x / 1000` | 只留 `<coordinate_space>0-1000</coordinate_space>`；不带像素尺寸 |
| 像素 | **本次观察已附加图片**上的列 | `x / attachedWidth` | 像素空间，外加该附件的 `WxH` |

像素钉在**那一次**观察里附上的栅格，不要钉捕获 backing 像素、Retina 倍率、逻辑窗口点，或之后的请求预览缩放。信封里的 `WxH` 和映射时的除数必须是同一对。该会话每一次请求的 POLICY、首帧通知、`position` 描述、点击结果文案、校验和映射，必须描述同一种编码。不得只关掉千分比文案却仍除以 1000，也不得仍写 0–1000 却按图宽来除。

### Overlay 默认值与会话合同

有两件可以不一致的事实：

1. **新建 overlay Computer Use 会话的 Desktop 默认值** — 右键菜单项和主窗口设置页开关反映的就是它。默认千分比打开。与其他 orb 偏好同类持久化（和 `selection-toolbar.json` / `orb-agent-models.json` 一级），不要写进 `floating-session.json`。
2. **每条会话的合同** — overlay 会话创建时记下的编码，必须能从会话日志重建，因为它对模型可见。某次请求的 POLICY、工具 schema、信封、校验和映射，读的是**这条会话**的合同，不是当前 Desktop 默认值。

用户关掉千分比之后，继续一条旧的千分比会话，仍走千分比。该开关之后的新建 overlay 会话（包括 overlay New）走像素。History 认领不得用 Desktop 默认值重盖会话合同。Overlay 创建、历史接上和新建已经会以 `saveAsDefault: false` 重套已存的 overlay **模型**（[悬浮球 Agent 模型菜单](../../implemented/feature/2026-09-17-orb-agent-model-menus.zh.md)）；坐标编码不是那个字段，也不得搭 `selectModel` 的便车。

今天 `tool:computer-use` 系统提示分节在进程内是一份全局文本。本产品要求一次请求组装出的 POLICY、参数描述和映射，跟随正在 prompt 的那条会话。

### 右键菜单与设置页开关

在 overlay 原生菜单里放一项与划词工具条同级的开关，紧挨划词项下方、仍在退出上方。不要放进悬浮球 Agent 设置或后台 Agent 设置，也不要放进每个模型的二级菜单。划词那一行由 [Desktop 划词工具条](../../implemented/feature/2026-09-16-desktop-selection-toolbar.zh.md) 拥有；本项是兄弟，不是子项。后台 Agent 设置走 `code_agent`，没有桌面点击空间。

[Desktop 悬浮球设置](../../implemented/feature/2026-09-18-desktop-orb-settings.zh.md) 页在划词卡片之后增加一张兄弟卡片：标题、说明，以及绑到同一 Desktop 默认值的 `Switch`（打开表示千分比开）。文案由 orb 设置页的 locale 词典拥有，和划词一样。Windows 上整页悬浮球设置保持禁用，包括这个开关。

原生菜单文案跟划词一样（当前状态，动作为取反）：千分比开着 → **Disable millifraction coordinates** / **关闭千分比坐标**；千分比关着 → **Enable millifraction coordinates** / **打开千分比坐标**。菜单标签和设置页开关都显示「下一局新建 overlay 会话」的 Desktop 默认值，不是当前打开对话的读数。人正停在旧的千分比记录上、默认值已经是像素时，默认值仍显示为关。

两处控件都不得改写已打开会话的合同。划词开关会立即持久化；坐标控件不得如此。打开任一控件都弹出确认（由 shell 弹出原生对话框，不要塞进 72px 球里的卡片）：新编码在**新**对话里生效；当前对话不变，仍可从 History 回去。取消则控件、默认值和会话都不动 — 不得先拨设置页开关再弹回。确认后走菜单和设置页**共用**的一条应用路径：写入取反后的默认值，经现有的 overlay New / `session.create` 路径创建一条使用该编码的空白 overlay Computer Use 会话（不要在设置页渲染进程里另写一套 create），并把 `floating-session.json` 指过去。上一条会话留在 `dsh_orb` 工作区。不要在旧日志里热替换 POLICY。

### 共用工具，分叉合同

不要再挂一份 Computer Use 插件，也不要再注册一个 `click`。工具名、互斥、再截图和 HID 仍是一条路径。`execute` 读会话合同，把 `position` 变成截图比例，然后复用现有的全局映射。`drag` 的起点和终点使用同一种编码。像素模式取消 0–1000 上限，按被点击的那次观察的附件尺寸校验。

### 持久化与 History

为该编码追加一条 required-on-read 的会话事实（插件通知或专用的 `SessionEventMap` 成员）。普通事件词表增长不提升 `SESSION_FORMAT_VERSION`；不得把该事实标成 `ignorable: true` — 读端若跳过，就会把已存的 `position` 数组映射错。像素模式的观察必须记下用作除数的附件 `WxH`。Overlay History、overlay 输入框继续聊，以及主窗口侧栏里同一条 `dsh_orb` 会话，都遵守这条已记录的编码。

## 考虑过的替代方案

**只加强千分比提示词，不提供第二种编码。** 已上线的 POLICY 已经写明 × 1000 并禁止像素。GLM 类路由在宽截图上第一下仍会系统性点偏。产品需要像素编码，而不是更长的提示词。

**全局下拉或设置页开关改写正在进行的会话。** 在已有记录里替换 POLICY，会把两种编码混进同一份日志。选定的产品改为新建会话。

**设置页开关像划词那样立即持久化，然后再确认。** 那会在用户同意新对话之前就改掉默认值，取消时还得撤回一次写入。必须先确认，再写入并创建。

**在每个模型的二级菜单里、思考强度旁边放 checkbox。** 切换编码仍然要新开对话，绑到目录里的某一行就等于选 GLM 时强制新开。Electron 禁止既是 checkbox 又带 `submenu` 的项；没有思考模式的模型今天是叶子，那样会迫使所有 overlay 模型都变成嵌套菜单。编码是 overlay 会话合同，不是模型属性。

**两套 Computer Use 插件（千分比包对像素包）。** 会复制十三套工具、首帧附加、同意门槛和 macOS 后端。卸下一份再装另一份并不是会话切换。一个插件、两种编码才是组合方式。

**Host 自动判断：看起来像像素的数就当像素。** `[754, 155]` 在两套空间里都合法。自动判断做不到。会话合同必须显式。

**像素模式却不展示 `WxH`。** 捕获像素、附件像素、请求预览像素和逻辑点不是同一套数。这些尺寸在**不是**点击空间时展示，正是当初改成 0–1000 的原因；像素模式下已附加图的 `WxH` **就是**点击空间，必须出现在观察上。

**History 认领时像重套 overlay 模型那样套上 Desktop 默认值。** 那会把旧的千分比对话改写成像素（或反过来），破坏本产品规则。

## 验收标准

- 新建 overlay Computer Use 会话默认千分比 0–1000，信封上不带附件像素尺寸。
- Overlay 原生菜单（划词下方、退出上方）和主窗口悬浮球设置页开关，只有同一套确认之后才取反该默认值。确认经共用的 overlay New 路径创建另一编码的空白 overlay 会话，且不改写上一条会话的合同。取消为空操作，设置页开关不得先闪一下。设置页卡片与划词卡片同构；Windows 上随整页禁用。
- 关掉千分比之后，overlay New 以及之后的 overlay 创建使用像素模式：信封写出已附加图的 `WxH`，POLICY 和 `position` 文案与像素一致，HID 映射按该 `WxH` 相除。
- 重新打开一条千分比 History 并发送新的用户消息时，即使 Desktop 默认值已是像素，仍把 `position` 按 0–1000 映射。主窗口 `dsh_orb` 侧栏打开同一条会话时同样如此。
- 后台 Agent 设置没有坐标项。除非本提案随后扩展，Headless/Web 的 Computer Use snapshot 仍只使用千分比。
- 一条已记录的 overlay snapshot（或拥有方本地的等价物）钉住两种编码、「确认后创建」路径，以及 History 继续时沿用出生编码。界面文案由 locale 词典拥有。

## 风险

像素模式把栅格重新交给模型。若请求投影在附加之后再次缩放，模型计数的网格仍可能和信封 `WxH` 不一致；千分比正是为了避开这个缺口，像素模式只帮得上原生 token 贴着附件栅格走的模型。用户关掉千分比后在**新**会话里再选千问类模型，会一直按像素点，直到再次打开千分比并确认又一个新对话。菜单文案和设置页开关显示的是默认值，不是打开的记录，History 聚焦时容易看错；确认文案必须写明当前对话不变。
