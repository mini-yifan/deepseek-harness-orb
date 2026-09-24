# Agent Note: 悬浮球与后台 Agent 模型菜单

Status: implemented

[English](2026-09-17-orb-agent-model-menus.md) | 中文

## 问题

macOS 悬浮球在 overlay 创建、历史接上和新建时总是选 DeepSeek-V41-Flash、思考强度 Max，且 `session/selectModel` 还会写入 `agent-default-model`。后台 `code_agent` 会话随后继承那个全局新建对话默认。用户需要从球上独立选择 overlay 与后台路由，且不改主窗口 composer 默认。

## 决策

overlay 原生右键菜单在每次右键时用实时 `session/modelCatalog` 重建，在「打开主窗口」之后加入悬浮球 Agent 设置与后台 Agent 设置。每个子菜单按目录 `groups[]` 分组（`group.name` 作为禁用标题，持久化 `group.id`）。带 `reasoning.efforts` 的模型是连续 `radio` 的 submenu，文案用 `effort.name`；当前模型在该行前加 ✓，因为 Electron 的勾选项和 submenu 互斥，checkbox 构造后再赋 `submenu` 会抛错，思考模式父项也画不出原生勾。没有推理的模型是叶子 `checkbox`。绝不挂上 `submenu: []`。有效思考强度是 `current.reasoningEffort ?? defaultEffort`。仅当存在 efforts 且没有 `defaultEffort` 时才加「默认」单选项。overlay 列出目录里的全部模型。两个 Agent 的勾选彼此独立。点击某一强度即选中该 provider + model + reasoningEffort。

选择持久化为 Desktop profile 的 `orb-agent-models.json`（`{ overlay, background }`），不写进 `floating-session.json`。文件缺失或无效时，两边都用 `{ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }`。主窗口[桌面悬浮球设置](2026-09-18-desktop-orb-settings.zh.md)页立即写入同一 JSON。

`SessionSelectModelRequest.saveAsDefault` 对 composer `/model` 默认为 true。overlay 与 `code_agent` 传 `false`，因此不写 `agent-default-model`。overlay 创建、历史接上和新建应用已存的 overlay 选择。现场菜单点击先持久化，再 `webContents.send`，渲染进程立即对当前 overlay 会话 `selectModel`。

后台应用仅限新建。Electron 在 Host 就绪以及用户改后台 Agent 设置时，经现有 Host 进程 IPC 推送 `orb-code-agent-model`。Desktop Host 插件 `computer-use-orb-code-agent-model` 发布可选的 `ctx.orbCodeAgentModel`。`code_agent` 只在 `session_id === undefined` 分支、create 之后 prompt 之前 `ctx.get('orbCodeAgentModel')`。续写不变。没有该服务的 Web / headless 仍继承 `agent-default-model`。实验包不导入 desktop-host。

[桌面悬浮球](2026-09-14-desktop-floating-orb.zh.md) 仍拥有 overlay 构造、一等 `code_agent` 会话，以及 runtime extra。

## 考虑过的替代方案

**把字段写进 `floating-session.json`。** `writeFloatingSessionId` 会整对象重写，并把会话身份和模型偏好绑在一起。

**继续写入 `agent-default-model`。** overlay 与后台选择会改掉主窗口新建对话。

**在 `code_agent` 续写时也应用后台选择。** 那会改写用户可能已在侧栏接着聊的进行中 standard 会话。

**把 overlay 模型滤成仅图像路由。** 球上 Computer Use 会话需要视觉，但目录菜单与主窗口选择器一致；不支持的路由会让 `selectModel` 失败，会话留在当前模型。

**在紧凑 overlay 上放 `/model` 弹出层。** 原生嵌套菜单复用 Host 目录，不必在 72px 球上再做一个 Client 选择器。

**从实验包导入 `@deepseek-ai/dsh-desktop-host`。** 发行应用不得点名实验包，反向导入会把 Computer Use 绑到 Electron。可选 `ctx.get` 才是 Host 侧缝。

## 影响

主窗口 composer 默认与球保持独立。关掉再打开 overlay 仍用上次 overlay 路由。Desktop 上新建 `code_agent` 用上次后台路由；按 id 续写不会。缺少 Host 服务时静默继承 `agent-default-model`，不会在加载时失败。`code_agent` 的工具 schema 与 POLICY 不提及这一 UI 偏好。

## 测试

`floating-window.spec.ts` 钉住相对打开主窗口 / 工具条 / 退出的子菜单位置、彼此独立的勾选，以及当前思考模型行上的 ✓ 前缀。`floating-agent-menu.spec.ts` 钉住空目录、radio 对 checkbox、「默认」单选，以及不出现空 submenu。`orb-agent-models.spec.ts` 钉住默认值、无效 JSON，以及两边独立往返。`floating-renderer.spec.ts` 钉住已存 overlay `selectModel` 且 `saveAsDefault: false`，以及现场菜单应用。`session-models.host.spec.ts` 钉住跳过与写入 `agent-default-model`。`code-agent.spec.ts` 钉住有服务时仅新建调用 `selectModel`，省略服务时创建载荷不变。Desktop Host 插件测试与 Electron `setOrbCodeAgentModel` IPC 覆盖推送。overlay YAML id 与 locale 菜单文案已钉住。
