# Agent Note: 桌面端设置里的悬浮球分页

Status: implemented

[English](2026-09-18-desktop-orb-settings.md) | 中文

## 问题

头像、悬浮球 Agent、后台 Agent 与划词开关只活在 macOS 球的原生右键菜单和 Desktop 配置 JSON 里。主窗口设置没有对应分页，且 `dsh web` 不能多出一列无法操作的导航。

## 决策

Desktop Host 组合插入 `@deepseek-ai/dsh-client-ui-settings-orb`，作为 `settings.section` id `orb`（order 25）。[`packages/bundle/web-app/cordis.patch.yml`](../../../../packages/bundle/web-app/cordis.patch.yml) 不列出它，因此 `dsh web` 从不注册该行。Windows 仍加载 Desktop overlay：页面可见，`supported` 为 false，全部控件禁用。

主窗口是 `dsh-app://app`。[`preload-app.ts`](../../../../apps/desktop/src/preload-app.ts) 向该 hostname 暴露 `dshDesktop.orb`，并把启动桥留在 `shell`。新 IPC 使用 `assertDesktopSender(..., ['app'])`。非 darwin 的写入抛出 `dsh desktop: floating ball settings require macOS`。

自定义图片拷进配置目录的 `orb-avatar` 与 `orb-avatar.json`（GIF/PNG/WebP，2 MB 上限）。`dsh-app://app/orb-avatar` 与 `dsh-app://shell/orb-avatar` 提供该文件或 `deepseek-avatar-square.gif`。叠加与后台模型仍写入 `orb-agent-models.json`；划词开关调用 `SelectionToolbarController.setEnabled`。千分比坐标卡片在 Electron main 里确认，由 [Overlay 会话上的 Computer Use 千分比与像素坐标模式](2026-09-19-computer-use-session-coordinate-modes.zh.md) 拥有。Access、打开主窗口和退出留在原生菜单。目录读取仍走 Host `session/modelCatalog`。千分比卡片后的 macOS 屏幕录制与辅助功能卡由 [Desktop Orb TCC 门](2026-09-20-desktop-orb-tcc-gate.zh.md) 拥有。

## 考虑过的替代方案

**用 `ctx.remote.$host.isLoopback` 门控该分区。** Loopback 不是 Desktop 与 `dsh web` 的判定。本机远程浏览器会看到一页并不存在的 IPC。

**把 overlay 偏好放进 Host `settings.yaml`。** 原生菜单和 floating renderer 已经拥有 Desktop 配置 JSON。Host 命名空间会重复 Electron 壳仍必须读取的事实。

**从 `ui-overlay-chat` 注册该分区。** 该包占用 overlay 的 `'root'`。设置页跑在主窗口，不在 overlay iframe。

**在 web-app 插件里运行时检查 `window.dshDesktop`。** `dsh web` 仍会下载并 apply 该插件。仅 Desktop insert 保持 Web roster 不变。

**把 Access、打开主窗口和退出搬进设置。** 那些是 overlay 窗口动作，不是主窗口该拥有的持久偏好。

## 影响

在设置里改球头像或模型会立即更新正在显示的 overlay，无需重启。原生右键菜单仍是球内改同一模型和工具栏字段的路径。Windows 用户看到禁用页，而不是缺少导航行。自定义头像不打进 `apps/desktop/renderer/`。`start:desktop`（`--skip-build`）会重建本包，以便 Desktop Host 能加载 `lib/`。

## 测试

桌面端单测覆盖头像安装/恢复/2 MB 拒绝、仅 `dsh-app://app` 暴露 `dshDesktop.orb` 的 `preload-app`、`SelectionToolbarController.setEnabled`，以及 `floating.js` 应用推送的头像 URL。`ui-settings-orb` 覆盖分区注册、快照加载、被拒绝的选择、Windows 横幅与立即写入。`dsh web` snapshot 不变。
