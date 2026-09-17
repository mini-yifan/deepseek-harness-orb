# Agent Note: Overlay Access 选择器与共用的球权限

Status: implemented

[English](2026-09-17-overlay-access-picker.md) | 中文

## 问题

悬浮球面板没有 Access 控件。Desktop Host 把 overlay Computer Use 写死成完全权限，后台 `code_agent` 留在工作区内修改；同一条 Computer Use 会话在主窗口用 Access 芯片改权限后，用户继续在主窗口聊天时可以保持，但球上也不显示 overlay 工作会用哪一档。

## 决策

展开后的 overlay 顶栏在历史和新建之间放一枚 Access 芯片。芯片显示当前标签（`仅可查看` / `工作区内修改` / `完全权限`，由 locale 拥有），并打开这三档 id（`read-only` / `workspace-write` / `danger-full-access`）的下拉。完全权限没有确认框。芯片与历史、新建共用同一条竖向边；[Overlay 历史与新建跟随输入胶囊对侧](../bug-fix/2026-09-17-overlay-history-new-follow-expand.zh.md) 拥有该位置。

该选择以 Desktop profile `orb-permission.json`（`{ preset }`）持久化。文件缺失或无效时用 `danger-full-access`。Electron 在 Host 就绪以及 overlay 芯片改选时，通过现有 Host 进程 IPC 推送 `orb-permission`。Desktop Host 插件 `computer-use-orb-permission` 保存该实时预设（第一次推送前的出厂默认是完全权限），并在 `session/created` 上当 `agentPreset` 为 `computer-use` 或 `standard` 且 `cwd` 解析为 `join(resolveDshHome(), 'dsh_orb')` 或其真实子目录时调用 `permissionPresets.set`。当前预设已是该值时，`set` 不会再追加。插件在 apply 时不遍历 `sessions.list()`，因此已经列出的会话上主窗口 Access 芯片的更改会保留，直到 overlay 工作再次应用。

overlay 输入提交、划词工具条提示词，以及点选芯片，都通过 Desktop IPC 持久化芯片。该 IPC 带上当前 overlay 会话 id 时，Host 插件用 `permissionPresets.set` 钉选该会话，并且不调用 `commands/execute`。Access 持久化缺失时，overlay 发送仍会排队 `session/prompt`。因此用户在主窗口改权限并继续聊天时保持该权限；从球上聊天或在 overlay 芯片上点选，会把顶栏预设写回该会话。新建的 `code_agent` / `dsh_orb` 或其子目录上的 standard 会话在创建时拿到实时 overlay 预设。出了这棵目录树的 Computer Use 或 `code_agent` cwd 留在 Host 默认，以便那里的主窗口 Access 芯片仍然可用。[Overlay Computer Use 后台调度](2026-09-17-orb-code-agent-dispatch.zh.md) 拥有这些子目录的新建。

[桌面悬浮球 Computer Use 完全权限](2026-09-15-desktop-orb-computer-use-full-access.zh.md) 仍拥有不改 profile `permission.defaultPreset`、以及不钉选每一条 Computer Use 会话。[桌面悬浮球](2026-09-14-desktop-floating-orb.zh.md) 拥有 overlay 构造和 `code_agent` 新建。

## 考虑过的替代方案

**继续写死完全权限钉选、球上没有芯片。** 球无法显示或持久化用户的 Access 选择，overlay 工作也不能把存下来的较弱预设再应用回去。

**在 overlay 文档上复用 React `PermissionSelect`。** `floating.html` 是原生 JS，不是 Client 输入条；完全权限确认在球上也没有宿主。

**Electron 每次推送预设时遍历 `sessions.list()`。** 那会在没有 overlay 聊天的情况下，覆盖每条匹配 `dsh_orb` 会话上主窗口 Access 芯片的更改。

**只把 overlay 预设应用到 Computer Use。** 后台 `code_agent` 会与用户刚选的芯片使用不同的沙箱。

**把预设写进 `floating-session.json`。** 会话身份会和 Access 绑在一起，而且 `writeFloatingSessionId` 会重写整个对象。

## 影响

GUI 点击/输入仍不在沙箱里。overlay 的 bash 和文件系统，以及新建的 `dsh_orb`（或其子目录）standard / `code_agent` 会话，跟随存储的 overlay Access。用户若在主窗口降级并继续在那里聊天，会保持这次降级，直到从球上发送或在 overlay 芯片上点选。重启 Desktop 会保留上次的 overlay Access 文件。

## 测试

Desktop 持久化测试把缺失 JSON 默认成 `danger-full-access`，并往返 `workspace-write` / `read-only`。Host 测试把 Computer Use 和 orb cwd 以及 orb 子目录上的 standard 钉成实时预设，把其他 cwd 上的 Computer Use 以及 `dsh_orb` 的兄弟路径保持不变，当前值已匹配时不再追加，在 apply 时不改已经宣布过的球上 Computer Use 会话，并在 Electron 推送该会话 id 时钉选已挂接的球上会话。overlay 渲染测试把芯片放在历史和新建之间、显示完全权限、把工作区内修改的点选连同会话 id 一起持久化，在 overlay 发送和划词工具条提示词上于 `session/prompt` 之前调用 Desktop IPC，并在 Access IPC 缺失时仍能发送。Electron 测试在 Host 就绪时推送 `danger-full-access`。
