# Agent Note: 桌面悬浮球 Computer Use 完全权限

Status: implemented

[English](2026-09-15-desktop-orb-computer-use-full-access.md) | 中文

## 问题

Desktop Host 权限预设会在每个新会话上钉选 `workspace-write` 和审批 `ask`。macOS 悬浮球在 `$DSH_HOME/dsh_orb` 上创建 Computer Use，因此 bash 和文件系统无法在桌面或文稿里 mkdir 或写入。overlay 没有 Access 芯片，而 GUI 点击/输入本来就不在沙箱里。

## 决策

Desktop Host 插件 `computer-use-orb-permission` 在 Host 钉选之后监听 `session/created`，当 `session.header.agentPreset` 为 `computer-use` 且 `session.header.cwd` 解析为 `join(resolveDshHome(), 'dsh_orb')` 时调用 `permissionPresets.set(session, 'danger-full-access')`。它在 apply 时遍历 `ctx.sessions.list()`，因此 Host 再打开时会升级已经宣布过的球上 Computer Use 会话。当前预设已是该值时，`set` 不会再追加。新创建会先记下 `workspace-write`，再记下 `danger-full-access`。同一条 `dsh_orb` Computer Use 会话若在主窗口用 Access 芯片降级，下次 Host 宣布时会被覆盖。球上没有选择器，因此不会走完全权限确认。

`dsh_orb` 上的 `standard` 会话（含 `code_agent` 子会话）仍用 Host 的 `workspace-write` 默认。其他工作区上的 Computer Use 也留在该默认，以便主窗口 Access 芯片仍然可用。[桌面悬浮球](2026-09-14-desktop-floating-orb.zh.md) 拥有 overlay 创建。已归档的 [workspace-write 界面默认](../../archived/feature/2026-07-31-workspace-write-surface-default.md) 仍是历史记录。

该插件 inject `permissionPresets` 和 `sessions`，缺少任一服务时为空操作。overlay YAML 加载 `../lib/computer-use-orb-permission.js`。渲染进程 `session.create` 载荷是 `{ agentPreset: 'computer-use', workspaceId }`。

## 考虑过的替代方案

**改 `packages/bundle/base/cordis.patch.yml` 或设置里的 `permission.defaultPreset`。** 那会取消 Web、TUI 和主窗口编码会话的沙箱。

**钉选每一条 Computer Use 会话。** 主窗口在其他工作区上的 Computer Use 必须保持工作区内修改和 Access 芯片。

**钉选 cwd 为 `dsh_orb` 的每一条会话。** 后台 `code_agent` / `standard` 行必须保持 Host 默认。

**从 `floating.js` 传入权限预设。** Host 拥有这次钉选；overlay 创建载荷不增加沙箱字段。

**给球加上 Access 芯片。** overlay 按设计没有选择器，完全权限确认也没有宿主。

## 影响

球上 Computer Use 的 bash 和文件系统可以在没有逐条命令批准的情况下写入 `dsh_orb` 以外。在主窗口打开该会话会显示完全权限。用户若在那里降级，下次 Host 宣布或再打开时会丢掉这次降级。GUI Computer Use 同意仍是实验包的安装/patch 门槛。

## 测试

Desktop Host 测试把 Computer Use 加 orb cwd 钉成最后预设 `danger-full-access`，把 `standard` 加 orb cwd 以及 Computer Use 加其他 cwd 保持不变，并在已经是完全权限时不再追加。overlay YAML 含该插件 id 与路径。悬浮球渲染进程创建载荷仍是 `{ agentPreset: 'computer-use', workspaceId }`。不刷新 `snapshots/session/computer-use` 夹具；现场 headless 创建不是球的路径。
