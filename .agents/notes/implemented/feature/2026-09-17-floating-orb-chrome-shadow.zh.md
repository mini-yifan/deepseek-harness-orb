# Agent Note: 悬浮球 CSS 投影与固定描边

Status: implemented

[English](2026-09-17-floating-orb-chrome-shadow.md) | 中文

## 问题

macOS overlay 是透明的 `type: 'panel'` 窗口，且 `hasShadow: false`。展开后的 320×420 白底面板没有外沿，叠在其他浅色窗口上会融进去。固定时对 `#panel` 和 `#ball` 画 `box-shadow: inset 0 0 0 3px`；灰色输入条（`#panel::after`）盖住这圈内描边的下沿，所以只有对话卡片看起来有描边。收起的 72px 球同样紧贴桌面，没有层次。

[桌面悬浮球](2026-09-14-desktop-floating-orb.zh.md) 仍拥有 overlay 构造、展开几何与固定/收起。本笔记拥有外壳如何与桌面分开：CSS 投影、细边、外圈固定描边，以及让这些绘制能画出来的 12px 窗口留白。

## 决策

视觉尺寸仍是 72px 与 320×420。`FLOATING_CHROME_INSET`（12px，`floating.css` 里的 `--chrome`）在 overlay 窗口四周留白，避免 CSS 绘制被裁掉。窗口原点是 72px 球原点减去该留白。工作区夹取保证 72px 可视球留在显示器内；留白可以超出工作区边缘 12px。收起/展开用窗口尺寸和 `FLOATING_BALL_WINDOW_SIZE`（96px）比较，而不是 72。

收起态 `#ball` 用圆形投影、无边框。展开未固定时 `#panel` 用面板投影加 1px `--border` 细边；`#ball` 去掉投影并套上同一条 1px 环，避免轮廓在头像处断开。固定时 `#panel` 与 `#ball` 用 `box-shadow: 0 0 0 3px var(--pin)`（外圈，非内描边）替换投影，描边沿圆角面板、输入条下沿和头像走。`#ball` 不用 `overflow: hidden`；GIF 仍靠 `#ball-gif` 的 `border-radius` 裁圆。停止仍在 72px 胶囊端内缩 14px，因此其 inset 是 `calc(var(--chrome) + 14px)`。

overlay 仍设 `hasShadow: false`。透明窗口上的 Electron 系统阴影会框住整块矩形窗口，包括空白留白。

## 考虑过的替代方案

**打开 BrowserWindow `hasShadow`。** macOS 会给 96×96 或 344×444 矩形投影，包括透明四角，而不是圆球或圆角面板。

**保留内描边固定环，只加投影。** 输入条仍会挡住内描边的下沿。

**对 12px 留白做像素级点击穿透。** `setIgnoreMouseEvents({ forward: true })` 加渲染进程命中测试是另一次 overlay-guard 改动。12px 留白是对置顶命中泄漏的取舍。

**固定时用 3px `border` 而不是外圈 `box-shadow`。** 相对未固定的 1px 细边，内容盒会再缩 2px。

## 后果

球周围 12px 透明环可能吃掉本应落到后面应用的点击。拖动 IPC 仍发送可视球原点；Host 把该原点映射成窗口 bounds。CSS 的 `--chrome` 与 `FLOATING_CHROME_INSET` 必须保持相等。

## 测试

`floating-window.spec.ts` 钉住按球原点减留白计算的展开/移动/夹取窗口 bounds。`main-startup.spec.ts` 钉住展开面板窗口尺寸，以及收起移动/夹取在原点减留白处。`floating-renderer.spec.ts` 钉住 `--chrome: 12px`、展开细边与面板投影、`#panel` 与 `#ball` 的外圈 3px 固定描边、没有内描边固定环、`#ball` 没有 `overflow: hidden`、没有 `body:not(.expanded) #ball`，以及停止在 `calc(var(--chrome) + 14px)`。
