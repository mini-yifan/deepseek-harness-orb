# Agent Note: Overlay 历史与新建跟随输入胶囊对侧

Status: implemented

[English](2026-09-17-overlay-history-new-follow-expand.md) | 中文

## 问题

历史和新建在 overlay 面板上是 `position: absolute; top: 12px`。当球足够高、overlay 向下展开时，输入胶囊和头像占用同一条顶部带，这两个控件就会画到输入框下面。

[桌面悬浮球](../feature/2026-09-14-desktop-floating-orb.zh.md) 仍拥有 overlay 构造、展开方向，以及历史 / 新建做什么。本笔记拥有这两个按钮相对胶囊的位置。

## 决策

历史仍在左、新建仍在右。竖直边沿是输入胶囊对侧的对话记录边：`expand-up` 时 `top: 12px`，`expand-down` 时 `bottom: 12px`。`expand-down` 还会对调 `#panel` 内边距，让胶囊的 72px 带成为顶部留白，并把对话记录 / 历史列表 / 提问的 36px 内边距移到底部，最后几行不会被按钮挡住。

## 考虑过的替代方案

**提高 z-index，按钮仍留在顶部。** 它们仍会压在输入框上，挡住提示词。

**把历史和新建放到输入胶囊上。** 那会和胶囊已经占用的拖动、固定、停止抢同一角。

## 后果

水平位置不跟随 `expand-left` / `expand-right`。取消固定和收起会保留当前展开方向 class，因此按钮会留在对侧，直到下一次展开。

## 测试

`apps/desktop/tests/floating-renderer.spec.ts` 钉住历史在左、新建在右、默认 `top: 12px`、`expand-down` 下 `bottom: 12px`，以及向下展开时对调的面板与对话记录内边距。
