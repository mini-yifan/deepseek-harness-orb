---
description: "可选的实验性 GUI 工具，让视觉模型点击、输入、滚动并热键操作宿主桌面，并在首次用户回合与每次动作后附上屏幕截图。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-computer-use

[English](README.md) | 中文

## 概述

让具备视觉能力的 agent 看到宿主桌面，并提供五个互斥 GUI 工具，以便点击、输入、滚动、按热键与等待，然后在同一次工具结果中看到新屏幕。仅在你确实需要这种未沙箱化的控制时挂载。纯文本路由会跳过首张截图并拒绝这些工具。生产后端是 macOS；其他宿主仍会加载插件，并在执行时失败。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当你希望有一个操作真实桌面的专用 Computer Use agent 时，把这个私有 overlay patch 到正在运行的 Web 组合上。overlay 会追加一个系统 agent preset；GUI 工具注册在该 preset 的作用域里，而不是 Host 上。安装或 patch 就是同意门槛：这些工具不会在每次点击时询问。

### 何时选择

当视觉模型需要驱动 bash 无法到达的可见 GUI，并且你希望工具目录仅含 Shell、网页检索与抓取、五个 GUI 工具、`code_agent` 和 `ask_user_question` 时，选择它。普通编码会话、纯文本路由，以及不得授予屏幕录制加辅助功能权限的宿主，都不要选择。它不是 Skill，不是能力 seam，也不属于 `dsh-base`。Desktop macOS 也会把该 overlay 作为签名 runtime extra 挂上，以便悬浮球锁死 Computer Use 会话。

### 最小配置

`pnpm dsh` 已经走 tsx，因此 patch 源码 overlay 并重启正在运行的 `dsh web`。locator 插件的相对路径入口锚定在 patch 文件上，与 Inspector 的试用路径相同，因此 CLI 应用并不依赖这个实验包：

```text
pnpm dsh web --patch packages/experimental/tool-computer-use/cordis.source.patch.yml
```

新建会话，并在模式选择器中选择 Computer Use。已有会话保持其 preset。部署默认仍是 `standard`，该模式不会收到 GUI 工具。

`pnpm run build` 之后，[`cordis.patch.yml`](cordis.patch.yml) 以同样方式加载发出的 `./lib/preset-root.js` locator。

能够解析该包名的自定义 Loader 组合也可以改为挂载：

```yaml
- id: tool-computer-use
  name: '@deepseek-ai/dsh-experimental-tool-computer-use'
  config:
    postActionWaitMs: 500
    maxWaitSeconds: 5
    maxScreens: 4
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `postActionWaitMs` | `500` | 点击、输入、滚动或热键之后、重新截屏之前等待的毫秒数 |
| `maxWaitSeconds` | `5` | `wait` 工具的上限 |
| `maxScreens` | `4` | 每次观察最多捕获的显示器数量 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-tool-computer-use)是每个受支持字段及其 JSDoc 的穷尽式真源。

在 macOS 上，截屏需要屏幕录制权限，发送点击与按键需要辅助功能权限。缺少权限时，捕获或输入会失败，并在消息中指出对应的 TCC 权限。Windows 与 Linux 仍会加载；随后每个后端方法都会抛出 `computer-use: desktop control is implemented only on macOS`。

### 工具

没有 `screenshot` 或 `observe` 工具。首次用户回合已经包含当前屏幕，每个 GUI 工具都会在工具结果中以原生图片块返回动作后的屏幕。

| 工具 | 参数 | 动作之后 |
|---|---|---|
| `click` | `screen_index`、`position: [x,y]`（0–1000）、可选 `button`（`left`/`right`）、可选 `count`（1 或 2） | 点击、等待、重新截屏 |
| `input_text` | `screen_index`、`position`、`text`、可选 `replace`、可选 `submit` | 点击聚焦、输入、可选 Enter、等待、重新截屏 |
| `scroll` | `screen_index`、`position`、`direction`（`up`/`down`）、`scroll_level` 1–10 | 滚动、等待、重新截屏 |
| `hotkey` | `keys: string[]` | 组合键；系统截屏快捷键会被拒绝；等待、重新截屏 |
| `wait` | 可选 `wait_seconds`，受 `maxWaitSeconds` 限制 | 等待、重新截屏 |
| `code_agent` | `task`、可选 `session_id`、可选 `cwd` | 在一等 standard 会话上入队；返回该 `session_id` |

五个工具都互斥运行。`presentCall` 为 generic。文本信封标明屏幕序号、逻辑尺寸、0–1000 坐标空间、附件像素尺寸，以及 `saveImage` 缩放栅格时的倍率。它从不包含文件系统路径。

测试通过 `applyComputerUse(ctx, backend, config)` 注入假桌面，而不是 Config 上的 `driver` 钩子。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释插件背后的设计并指出实现代码；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

这个实验包有意保持为单个包。现有 agent-loop 已经会把包含图片的工具结果送入下一次模型请求，因此 Computer Use 不增加截屏工具，也不改变 loop 语义。接地文案是 `systemPrompt.section`，不是 Skill。第二个后端才值得把 Service Definition 与 Provider 拆开；本轮把 macOS 捕获/输入与工具放在同一包中。

首帧附件使用 `agent/pre-step`：监听器始终 `await next()`，然后在已领取批次包含 `source.kind === 'user'` 消息且路由声明图片输入时，追加 `form: 'notice'` 的插件 `user` 通知。`agent.inject()` 只会落在下一步。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：宿主平台后端上的 `name` / `inject` / `Config` / `apply` |
| [`src/preset-root.ts`](src/preset-root.ts) | 仅 overlay 使用的插件：发布额外的 agent-presets 根目录 |
| [`src/plugin.ts`](src/plugin.ts) | 共享的 `applyComputerUse`：策略、五个 GUI 工具、首帧 pre-step |
| [`src/code-agent.ts`](src/code-agent.ts) | 仅 Computer Use 的 `code_agent`：`session.create` / `session.prompt` |
| [`src/macos.ts`](src/macos.ts) | Darwin 通过 `screencapture` 捕获；click、scroll 与 hotkey 走 JXA `CGEvent`；`input_text` 通过 NSPasteboard 粘贴 |
| [`presets/computer-use/`](presets/computer-use/) | Computer Use agent preset：Shell、网页、GUI 工具、`code_agent`、`ask_user_question`、压缩 |
| — | 不发布运行时不变式伴生入口，因为本插件不引入新的会话事件；观察结果走现有的 `user/message` 与 `tool/result`。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [实验组](../README.zh.md) — 私有原型与公开的 Agent Teams 例外。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-computer-use) — 五个 GUI schema 与 `code_agent`。
- [添加工具](../../../docs/cookbook/adding-a-tool.zh.md) — UI 呈现意图（`generic`）与内容中的图片块。
- [Computer Use Agent Note](../../../.agents/notes/implemented/feature/2026-09-13-experimental-computer-use.zh.md) — 插件 vs Skill vs loop、Computer Use agent preset、结果内观察，以及同意门槛。
- [桌面悬浮球](../../../.agents/notes/implemented/feature/2026-09-14-desktop-floating-orb.zh.md) — macOS overlay、runtime extra，以及一等 `code_agent` 会话。
- [Headless computer-use snapshot](../../../snapshots/session/computer-use/snapshot.yml) — 在假桌面与视觉模型上人工编写的点击循环。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

插件挂载期间，每次请求都会组装一段稳定的 `tool:computer-use` 分节。下面的文本就是完整策略。

##### Computer Use policy

```markdown
Computer Use lets you see the current desktop and operate the GUI.

See: trust only the attached desktop screenshots. Do not assume windows, buttons, or text that are not visible in the latest image.

Coordinates: each screen uses a 0–1000 space. Pass position as [x, y] in that space together with screen_index. When a result envelope names downscale multipliers, convert attached-image pixels with those multipliers before choosing coordinates. Do not send raw pixel coordinates.

Step: take exactly one GUI action per tool call. After the call, the new screenshot is in the tool result; use that image for the next action.

Do not click or type into a target you cannot see. Do not read file paths off the screen; use bash with real paths.

Observation is not a tool. There is no screenshot or observe call. The first user turn already includes the current screens, and every GUI tool returns the post-action screens.

This session drives the real unsandboxed desktop. Use bash only for short commands inside a GUI loop. Do not use bash to write long reports or a whole project — send that work to code_agent.

Route the user's request yourself:
- Visible GUI such as opening WeChat or clicking a button in Pages → GUI tools only. Do not call code_agent.
- New background work such as writing a Word document → code_agent without session_id.
- Follow-up on the same artifact such as making that Word document's font green → code_agent with the session_id from that earlier result.
- Unrelated new background work such as making a gobang game after the Word document → code_agent without session_id. Do not reuse the Word session.
```

#### Token 影响

插件挂载期间，每次请求都有固定的策略成本。首帧屏幕与每次 GUI 工具结果都会增加图片 token，直到压缩。

#### KV Cache 影响

策略文本与工具 schema 不变时前缀稳定。首帧通知与工具结果图片追加在可复用请求前缀之后。插件 HMR 会替换该分节与 schema。

### 工具 schema

#### 模型看到什么

模型看到生成的 [`click`、`input_text`、`scroll`、`hotkey`、`wait` 与 `code_agent` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-tool-computer-use)。没有截屏工具。纯文本路由仍会收到 GUI schema，并在执行时被拒绝。`code_agent` 只注册在 Computer Use preset 中。

#### Token 影响

该工具视图中每次请求都有固定的 schema 成本。

#### KV Cache 影响

六个定义及其顺序不变时前缀稳定。注册生命周期可能从第一个变化的 schema token 起使复用失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是当前的包约束。该插件驱动真实的未沙箱化桌面。

- **仅 macOS** — 捕获与 HID 输入在 Darwin 上实现；其他平台在执行时抛错。
- **屏幕录制与辅助功能 TCC** — 捕获需要屏幕录制；点击、输入、滚动与热键需要辅助功能。插件不会提示授予这些权限。
- **没有逐次点击批准** — 安装或 patch 插件就是同意门槛；视觉循环不能在每个动作上询问。
- **宿主 chrome 会出现在截屏中** — Web 窗口会出现在捕获中。Desktop 会在 Electron 主窗口和 macOS overlay 上设置 `contentProtection`；没有 ScreenCaptureKit 窗口排除。
- **输入会使用字符串剪贴板** — `input_text` 通过 Cmd+V 粘贴，并在之后恢复先前的字符串剪贴板。其他剪贴板类型不会被恢复。
- **Retina 与附件尺寸** — backing scale 可能与附件栅格不同；使用 0–1000 空间以及信封中的倍率。
- **固定等待** — 动作后延迟只有 `postActionWaitMs`；没有像素差 stall。
- **没有拖拽、套索或启动应用** — GUI 覆盖是 click、type、scroll、hotkey 与 wait。后台文档与代码走 `code_agent`。
- **桌面 overlay 仅 macOS** — Windows Desktop 仍是单主窗口。实验包是签名 runtime extra，不是 Desktop Host 的 npm 依赖。
- **实验性原型，不提供稳定性承诺** — 本包为私有；schema 与后端可以自由变更。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
