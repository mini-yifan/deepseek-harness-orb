# Agent Note: 悬浮球只用主键拖动

Status: implemented

[English](2026-09-17-floating-orb-primary-pointer-drag.md) | 中文

## 问题

macOS overlay 把球上每一次 `pointerdown` 都当成窗口拖动的开始。因此右击也会记下抓取偏移并 capture 指针。随后 Electron 弹出原生 overlay 菜单，常常吞掉这次手势的 `pointerup`。渲染进程仍保持这次抓取。之后球上的 `pointermove`，包括没有按下任何键的悬停，都会调用 `floating.move`，窗口就跟着光标走，直到指针离开 overlay。overlay 外壳也没有 `user-select: none`，同一次右击会选中输入框占位符；单击球（按钮）不会折叠该选区。

[桌面悬浮球](../feature/2026-09-14-desktop-floating-orb.zh.md) 仍拥有 overlay 构造、展开几何与按抓取偏移移动。本笔记拥有哪些指针按钮启动这次抓取，以及外壳不可被选中文字。

## 决策

`floating.js` 仅在 `pointerdown.button` 为 `0` 时开始抓取，并且只在 `pointermove.buttons` 含主键位时移动窗口。`lostpointercapture` 与 `pointercancel` 走与 `pointerup` 相同的结束路径；已完成的拖动会抑制随后的钉住切换，避免被夺走的 capture 在之后的 `pointerup` 上钉住面板。次键 `pointerup` 不钉住。

overlay 的 `html`/`body` 设置 `user-select: none`。`#prompt` 与 `#question-custom` 保持 `user-select: text`，输入框和提问草稿仍可被选中，供 overlay 剪切/复制/粘贴菜单使用。

## 考虑过的替代方案

**只从 `webContents` 的 `context-menu` 经 IPC 取消抓取。** 其他路径若吞掉 `pointerup`，悬停仍会跟着走，而且挡不住右击选中外壳。

**在球上使用 `-webkit-app-region: drag`。** 原生窗口拖动会与钉住单击、停止，以及保持球原点固定的展开几何竞争。

**只设 `user-select: none`、不过滤指针按钮。** 蓝色选中会消失；右击的 `pointerup` 被吞掉后，悬停仍会移动窗口。

## 后果

中键不会钉住或拖动。右击球不再选中占位符；输入框获得焦点后仍可选中已输入文字。

## 测试

`apps/desktop/tests/floating-renderer.spec.ts` 钉住主键按抓取偏移移动、忽略次键 `pointerdown` 加悬停 `pointermove`、在 `buttons === 0` 与 `lostpointercapture` 上结束主键抓取，并要求 overlay 外壳 `user-select: none`、`#prompt` 与 `#question-custom` 可选择文字。
