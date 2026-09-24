# Agent Note: Overlay Appearance follows Host

Status: implemented

[English](2026-09-18-overlay-appearance-follows-host.md) | 中文

## 问题

macOS 悬浮球展开面板保持浅色，而主窗口跟随设置里的外观（`light` / `dark` / `system`）。原生外壳写死浅色调色板，overlay Compact Chat 的 ThemePresenter 强制浅色，因此 Host 深色从未画进 iframe。

## 决策

Overlay Compact Chat 与主窗口走同一条 ThemePresenter 路径：应用 Host 已解析的快照（`system` 已收成 `light` 或 `dark`），且不调用 `theme.setTheme`。每次 apply 后，iframe 向 `dsh-app://shell` 发送 `{ type: 'dsh.overlay.theme', colorScheme }`。[`floating.js`](../../../../apps/desktop/renderer/floating.js) 把该消息当作 `html[data-ds-dark-theme]` 与 `color-scheme` 的权威。iframe 尚未存在时，外壳用 `prefers-color-scheme` 猜测，这与出厂 `system` 默认一致。[`floating.css`](../../../../apps/desktop/renderer/floating.css) 保留浅色 `:root` 变量，并在 `html[data-ds-dark-theme]` 下覆盖为主窗口深色表面（底 `rgb(21, 21, 23)`，输入 `rgb(35, 35, 36)`）。OverlayChatRoot 绘制 `--dsw-alias-bg-base`。72px 球 GIF 与划词工具条保持原样。

[Overlay Compact ChatView](2026-09-16-overlay-compact-chat.zh.md) 仍拥有 iframe Compact 根。本笔记拥有在不写入 Host 设置的前提下跟随 Host 外观。

## 考虑过的替代方案

**保留 ThemePresenter 强制浅色。** 主窗口切到深色后，Compact 对话记录仍是白底。

**从 overlay 调用 `theme.setTheme`。** 那会写入 Host 设置并翻转主窗口。文档本地呈现已经跟随快照。

**在 Electron 主进程读取 `$DSH_HOME/settings.yaml`。** 那会在桌面壳里重复解析 Host 设置，而偏好为 `system` 时 `prefers-color-scheme` 已经覆盖首屏。

**外壳只听 `prefers-color-scheme`。** 显式选择浅色或深色时会与主窗口失步。

## 影响

当外观是与系统不一致的显式浅色或深色时，首次展开可能先闪系统配色，直到 iframe 发来消息。折叠会保留 iframe，之后再展开保持同步。划词工具条仍只有浅色。

## 测试

`ui-layout` overlay apply 跟随 `setTheme('dark')` 并发送 `dsh.overlay.theme`。ThemePresenter 没有强制浅色参数。`session-controller` 解析并拒绝 theme 消息。`floating-renderer` 钉住深色 CSS 变量、iframe 背景 `var(--white)`、matchMedia 首屏、Host postMessage，以及忽略外来源。
