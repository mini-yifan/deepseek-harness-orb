# Agent Note: 桌面划词工具条

Status: implemented

[English](2026-09-16-desktop-selection-toolbar.md) | 中文

## 问题

macOS 用户在其他应用里划选文字后，期望能搜索、翻译，并对这段话采取 agent 动作，而不新开会话。悬浮球没有划词工具条。Cordis 能力缝、会话格式字段、或从 Electron 应用导入实验 Computer Use 包，要么扩大产品 API，要么违反发行应用不得点名该包的规则。

## 决策

macOS Desktop 在 Electron 壳内拥有该功能。派生的 Darwin helper（`apps/desktop/src/macos-selection.swift`，编译到 `lib/macos-selection`）监视超过 8px 的左键拖拽，然后读取 `AXSelectedText`（及选区边界），或回退到剪贴板 `Cmd+C` 并备份/恢复。它忽略 Electron PID。选区载荷始终带上鼠标松开点。工具条放在该点下方 8px，而不用 AX 矩形：浏览器常把 `kAXBoundsForRangeParameterizedAttribute` 报成窗口局部或 chrome 原点矩形，会把条钉在窗口左上角。3 秒的 `pid + bundle + text` 去重、工具条窗外的左键按下、任意按键、右键或中键按下、非惯性滚轮和新的拖拽会隐藏工具条。helper 不为剪贴板回退里它投递的 `Cmd+C` 发出 `key`，触控板惯性（`momentumPhase`）也不会隐藏，因此划选后残留的滚动不会收起工具条。辅助功能关闭时发出 `untrusted` 且不截获事件；该事件首次出现时通过 `systemPreferences.isTrustedAccessibilityClient(true)` 打开系统设置。Windows 不启动监视器。

helper 是应用包内已签名的子进程（`asarUnpack: lib/macos-selection`），不是 `dlopen` 的 dylib。辅助功能/剪贴板投递的 TCC 身份以及 Electron 打包，在 helper 作为紧挨未打包主脚本的普通可执行文件时更简单。

第三扇 `type: 'panel'` 窗口加载 `dsh-app://shell/selection-toolbar.html`，且不激活 Desktop。文案由 locale 拥有。偏好与 `floating-session.json` 并列存为 `selection-toolbar.json`（默认 `enabled: true`，`translateTargetLanguage: 'zh'`）。overlay 右键切换启用。

搜索在默认浏览器打开 `https://www.bing.com/search?q=` 加上编码后的选区，不提示 agent。翻译隐藏工具条、展开球，并对当前 overlay Computer Use 会话执行 `session/prompt` `mode: 'queue'`。翻译不得显示或聚焦主窗口，也不得让 Desktop 保持前台：工具条 IPC 在 2 秒内忽略 `app` 的 `activate`，overlay 用 `showInactive` 展开，发送后再隐藏工具条，已聚焦的主窗口会 `blur()`，Darwin helper 通过 stdin `activate-pid` 重新激活划词所在进程（跳过 Electron 与 helper 的 pid）。搜索把焦点留给浏览器。该间隔之后的 Dock `activate` 仍会显示主窗口。打开语言菜单时，工具条面板绕紧凑条原点改尺寸（向下，或在工作区会裁切时向上），关闭后恢复紧凑尺寸，避免透明区域吞掉点击。翻译用户消息第一行恰好是 `Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.` Desktop 与 Computer Use 各自保存该字符串；Desktop 不得导入该实验包。[发给 Agent](2026-09-17-desktop-selection-send-to-agent.zh.md) 拥有第三个工具条按钮。

[实验 Computer Use](2026-09-13-experimental-computer-use.zh.md) 仍拥有首帧附件。`agent/pre-step` 的 `next()` 之后，当已领取批次里 `source.kind === 'user'` 的消息以该前导开头时，Computer Use 跳过 `observeDesktop`。POLICY 增加一段：该轮只在本聊天用文本回答；不调用 GUI 工具、`code_agent` 或 `screenshot`。schema 仍注册。`SESSION_FORMAT_VERSION` 不变。没有 OCR 路径，翻译也不走后台 `code_agent`。

[桌面 overlay-guard IPC](../architecture/2026-09-14-desktop-overlay-guard.zh.md) 的排除 id 是可见 overlay 窗口：球，以及仅在显示时的工具条。HID `input` 隐藏工具条，而不是给第二扇窗做点击穿透。overlay Computer Use 会话正在运行，或处于该 HID 区间时，工具条保持隐藏并跳过读取，避免 `input_text` 的剪贴板粘贴与 `Cmd+C` 竞态。

## 考虑过的替代方案

**Cordis 能力缝。** 搜索从不进入 agent，翻译只需要 overlay 的 `session/prompt`。为单一 Electron 宿主拆 Service Definition / Provider / Consumer 会增加包表面。

**用会话格式字段跳过首帧。** 那会为仅 Desktop 的提示词抬升 `SESSION_FORMAT_VERSION`。模型可见的前导可从日志重建，不需要新事件类型。

**从 Desktop 导入 `@deepseek-ai/dsh-experimental-tool-computer-use`。** 发行应用不得点名该包。前导字符串重复存放，并在两端测试文件里钉死。

**经 koffi 把 helper 当成 dylib 加载。** 同进程 CGEventTap 可以共享 Electron 的辅助功能身份，但 asar、代码签名和 Electron 原生模块策略下，派生并签名的可执行文件才是 `macos-sck-capture` 已经走过的打包路径。

**CoView 式的隔离翻译，或翻译走后台 Code agent。** 翻译必须出现在球与主窗口 `dsh_orb` 行已经在展示的同一条 Computer Use 会话上。隐藏翻译器或 `code_agent` 会拆开对话。

**本轮做 Windows 工具条。** 球已经只在 Darwin。UI Automation 加事件钩子是后续宿主的事。

## 影响

前导是兼容字符串：只改其中一份而不改 POLICY 段落，会附上截图或让模型调用 GUI 工具。必须授予辅助功能，否则工具条不会出现。剪贴板回退最多 150ms 覆盖字符串剪贴板；overlay-guard HID 与正在运行的 overlay 会话会关掉这条路径。打包应用必须解包 `lib/macos-selection`；从 `src/main.ts` 导入的测试不派生 helper，因为 TypeScript 源码旁没有该路径。

## 测试

Desktop 测试覆盖配置读写、Bing URL、提示词拼接、helper NDJSON 解析（含 AX 边界加鼠标松开点，以及 `dismiss`）、工具条几何（鼠标下方，含语言菜单向下增高与向上翻转）、控制器的搜索/翻译/发给 Agent/去重/暂停、`key`/`dismiss`/窗外 mouse-down 隐藏以及点在条内保持可见、忽略窗口原点 AX 边界的定位、翻译后恢复划词 pid 并跳过 Electron pid、可见 overlay 窗口的 overlay 排除 id、darwin 工具条构造、linux 跳过、翻译的 overlay IPC `session/prompt`、发给 Agent 的 attach IPC 与 overlay 聚焦、翻译时抑制 activate、interact 与 setContentSize IPC，以及 locale 拥有的工具条文案。Computer Use pre-step 测试在钉死的前导上跳过，并在普通用户轮次仍附加首帧；`tools.spec.ts` 与 `snapshots/session/computer-use/system-prompt.expected.md` 钉住 POLICY 段落。
