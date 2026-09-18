---
description: "桌面端设置里的 macOS 悬浮球分页：自定义头像、悬浮球与后台 Agent 模型，以及划词工具栏。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-orb

[English](README.md) | 中文

## 概述

本包在桌面端设置中增加「悬浮球」分页。用户可改球头像（GIF、PNG 或 WebP，建议不超过 2 MB，可恢复默认）、悬浮球 Agent 模型、后台 `code_agent` 模型，以及是否启用划词工具栏。每个控件立即写入 Desktop 配置。`dsh web` 从不显示该页。Windows 仍列出它，但全部控件禁用。

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

Desktop Host overlay 插入本插件。在主窗口打开设置并选择「悬浮球」。选择图片会拷进 Desktop 配置并更新正在显示的球。悬浮球 Agent 与后台 Agent 选择器使用与球右键菜单相同的 Host `session/modelCatalog` 分组。划词开关会启动或停止 macOS helper。Access、打开主窗口和退出仍留在原生右键菜单。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

节点半部是空的 `apply`，便于 Loader 列出该插件。浏览器半部注册 `settings.section`，id 为 `orb`，order 为 25。目录读取走 `ctx.remote.session.modelCatalog()`。偏好写入走 `dsh-app://app` 上的 `window.dshDesktop.orb`（应用 preload，不是 shell 启动桥）。自定义头像落在配置目录的 `orb-avatar` 与 `orb-avatar.json`；`dsh-app://app/orb-avatar` 与 `dsh-app://shell/orb-avatar` 提供该文件或打包 GIF。Windows 收到同一页且 `supported: false`。[桌面悬浮球设置 Agent Note](../../../.agents/notes/implemented/feature/2026-09-18-desktop-orb-settings.zh.md) 拥有组合、应用 preload 与配置头像。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [桌面端用户指南](../../../docs/user/guide/desktop.zh.md)——面向产品的悬浮球说明。
- [ui-settings-general](../ui-settings-general/README.zh.md)——投影本分区的设置外壳。
- [桌面悬浮球](../../../.agents/notes/implemented/feature/2026-09-14-desktop-floating-orb.zh.md)——overlay 窗口与 Computer Use 会话。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包为人类编辑 Desktop 配置偏好，不注册任何进入模型请求的内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定仅 Desktop 的设置页。它们是当前包约束，不是悬浮球待办。

- **仅 Desktop 组合** — `dsh web` 不插入本插件，因此导航行从不出现。
- **仅 macOS 可写** — Windows 列出该页并禁用全部控件；不会创建原生球。
- **不含 Access、打开主窗口或退出** — 这些仍留在球的右键菜单。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴生模块。本插件注册一个设置分区，不保留 Host 侧状态。
