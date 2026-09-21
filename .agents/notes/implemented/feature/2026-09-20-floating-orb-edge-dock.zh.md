# Agent Note: 悬浮球左右吸边

Status: implemented

[English](2026-09-20-floating-orb-edge-dock.md) | 中文

## 问题

macOS 悬浮球始终整颗留在屏幕上。用户把它停在左右边缘时，仍有一颗 72px 圆盘挡桌面，而 overlay 本来就拒绝吸边。没有办法把球藏进那条边，又标出它去了哪里。

[桌面悬浮球](2026-09-14-desktop-floating-orb.zh.md) 仍拥有 overlay 构造、展开几何与固定/收起。本笔记拥有何时拖动吸成竖条、竖条如何把球滑回来，以及哪些进行中的 overlay 状态拒绝吸边。

## 决策

冷启动仍是主显示器工作区右沿的完整 72px 球。吸边只存在内存里（overlay `BrowserWindow` 上的 `WeakMap`）；重启不会恢复竖条。

收起球上的主键拖动可以越出显示边缘；吸边在 **pointer-up 的 clamp** 提交，而不是 move 过程中。一旦 72px 圆盘的五分之一（`FLOATING_DOCK_OVERLAP`）越过当前屏左或右 **`bounds`**（屏幕边，不是工作区），overlay 整颗滑出屏幕（边外 `FLOATING_DOCK_OFF_GAP`，250ms），再缩成贴该边的可点条（`FLOATING_DOCK_HIT_WIDTH` × `FLOATING_DOCK_HIT_HEIGHT`）。CSS 画 6×72 灰色胶囊（`#dock-tab`，`#75757F`），带软光晕和 1800ms 透明度呼吸。上、下永不吸边。已吸边时 clamp 保持竖条；贴齐的自由浮球 clamp 仍不吸边。测试跳过滑动（`process.env.VITEST`）。

`unsnapDockedBall` 清掉吸边，把 72px 球放到屏外，再滑入 5px 内缩（`FLOATING_DOCK_IN_PAD`，300ms）。渲染进程在刚变成吸边后等 800ms，然后悬停 20px 内缩命中条（或把竖条往里拖过 `FLOATING_DOCK_DRAG_OFF`，距边三分之一个球）调用 `unsnap()`。这恢复成普通球，不保持“吸边同时 peek”的状态。展开面板（`setFloatingExpanded(true)`）也会清掉吸边。

固定面板不能吸边，直到通常的拖动先把面板收起。Computer Use 会话正在跑、提问卡亮着、或 TCC 门可见时，拖动不强制收起，且 `move` / `clamp(..., canDock=false)` 永不吸边。

## 考虑过的替代方案

**在 move 过程中吸附。** 拖动中立刻换成竖条会把球藏到指针下面，也和滑出动画打架。

**2 秒冷却并离开再进入后保持吸边 peek。** 悬停应滑回普通球，而不是第二种吸边尺寸。

**把贴齐工作区边缘当成已吸边。** 冷启动已经贴在工作区右沿。用 display `bounds` 外加五分之一重叠，才能让该原点保持整颗球。

**重叠边缘但未拖动时自动吸边。** 冷启动和贴齐停放的球必须保持 72px 圆盘，直到用户拖进去。

**重启后保持吸边。** 拖动位置本来就不落盘；重启后仍是竖条会让期待出厂 72px 右沿球的用户吃惊。

**上下边也吸。** 标记只是左右边缘上的竖胶囊。

**竖条用第二扇 BrowserWindow。** 现有 overlay 已参与 overlay-guard 截屏省略；吸边时 CSS 藏球。

## 后果

吸边竖条仍是可见 overlay 窗口，因此 overlay-guard 的截屏省略与 HID 点击穿透继续用它的 CGWindowID。可点宽度包含该边向内 20px 条。running、提问和 TCC 必须在 move 和 clamp 上传 `canDock=false`，否则收起的球仍可能在 pointer-up 跨过吸附阈值。

## 测试

`floating-window.spec.ts` 钉住五分之一左右阈值、上下不吸、默认原点和 clamp 不吸、clamp 时吸附、竖条几何、unsnap 内缩、展开清吸边、拖出，以及 `canDock=false`。`floating-renderer.spec.ts` 钉住 800ms 后悬停 unsnap，以及 running 时不强制收起/`canDock=false`。`preload.spec.ts` 与 `main-startup.spec.ts` 钉住 `floating.unsnap`，以及 move 保持未吸边直到 clamp 返回 `{ docked }`。
