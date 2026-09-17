# Agent Note: 桌面悬浮球 Computer Use 完全权限

Status: implemented

[English](2026-09-15-desktop-orb-computer-use-full-access.md) | 中文

## 问题

Desktop Host 权限预设会在每个新会话上钉选 `workspace-write` 和审批 `ask`。macOS 悬浮球在 `$DSH_HOME/dsh_orb` 上创建 Computer Use，因此 bash 和文件系统无法在桌面或文稿里 mkdir 或写入。GUI 点击/输入本来就不在沙箱里。

## 决策

Desktop Host 插件 `computer-use-orb-permission` 在 Host 钉选之后监听 `session/created`，当 `session.header.agentPreset` 为 `computer-use` 或 `standard` 且 `session.header.cwd` 解析为 `join(resolveDshHome(), 'dsh_orb')` 时，用实时 overlay Access 预设调用 `permissionPresets.set`。实时预设是 Electron 推送的 overlay 偏好，第一次推送前默认为 `danger-full-access`。当前预设已是该值时，`set` 不会再追加。新创建 Computer Use 在两档不同时会先记下 `workspace-write`，再记下 overlay 预设。插件在 apply 时不遍历 `ctx.sessions.list()`。其他工作区上的 Computer Use 留在 Host 默认，以便那里的主窗口 Access 芯片仍然可用。

[Overlay Access 选择器与共用的球权限](2026-09-17-overlay-access-picker.zh.md) 拥有 overlay 芯片、`orb-permission.json`、overlay 发送时的 `/permission` 再应用，以及与后台 `code_agent` 共用该预设。[桌面悬浮球](2026-09-14-desktop-floating-orb.zh.md) 拥有 overlay 创建。已归档的 [workspace-write 界面默认](../../archived/feature/2026-07-31-workspace-write-surface-default.md) 仍是历史记录。

该插件 inject `permissionPresets` 和 `sessions`，缺少任一服务时为空操作。overlay YAML 加载 `../lib/computer-use-orb-permission.js`。渲染进程 `session.create` 载荷是 `{ agentPreset: 'computer-use', workspaceId }`。

## 考虑过的替代方案

**改 `packages/bundle/base/cordis.patch.yml` 或设置里的 `permission.defaultPreset`。** 那会取消 Web、TUI 和主窗口编码会话的沙箱。

**钉选每一条 Computer Use 会话。** 主窗口在其他工作区上的 Computer Use 必须保持工作区内修改和 Access 芯片。

**从 `floating.js` 创建载荷传入权限预设。** Host 仍在 `session/created` 上钉选；overlay 创建载荷不增加沙箱字段。overlay 发送时另行应用 `/permission`，由 Access 选择器笔记拥有。

## 影响

球上 Computer Use 以及新建的 `dsh_orb` standard / `code_agent` 会话，bash 和文件系统跟随存储的 overlay Access。在主窗口打开该会话会显示同一档，直到用户在那里改 Access 芯片。GUI Computer Use 同意仍是实验包的安装/patch 门槛。

## 测试

Desktop Host 测试把 Computer Use 加 orb cwd 以及 standard 加 orb cwd 钉成实时 overlay 预设（出厂默认 `danger-full-access`），把 Computer Use 加其他 cwd 保持不变，该预设已是当前值时不再追加，并在 apply 时不改已经宣布过的球上 Computer Use 会话。overlay YAML 含该插件 id 与路径。悬浮球渲染进程创建载荷仍是 `{ agentPreset: 'computer-use', workspaceId }`。不刷新 `snapshots/session/computer-use` 夹具；现场 headless 创建不是球的路径。
