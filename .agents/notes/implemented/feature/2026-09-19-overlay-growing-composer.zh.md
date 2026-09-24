# Agent Note: Overlay 输入框绕球长高

Status: implemented

[English](2026-09-19-overlay-growing-composer.md) | 中文

## 问题

macOS overlay 输入框曾是 72px 胶囊里的单行 `<input type="text">`。草稿大约只占头像球旁边 196px，一条常见的 Computer Use 指令多半要靠横向滚动才看得到。Cursor 和主窗口 composer 会折行并长高；球上的输入框不会。

[桌面悬浮球](2026-09-14-desktop-floating-orb.zh.md) 仍拥有 overlay 构造、320×420 面板尺寸和 72px 球原点。本笔记拥有 overlay 草稿。

## 决策

`#prompt` 是 [`floating.html`](../../../../apps/desktop/renderer/floating.html) 里的 `contenteditable` 文本框。空着和字很少时灰色胶囊保持 72px。只有当前盒子装不下时，`--composer-height` 才朝对话记录按 `--prompt-line`（20px）加一格，上限 `--composer-max`（`72px + 3 × 20px`）。Compact 对话的内边距和划词 chip 跟随该高度。Electron 窗口仍是 320×420；球原点不动。

`#prompt` 上下有 12px 内边距，字形不贴胶囊边。`::before` 浮动块高度为 `var(--composer-height)`，并用等量负上边距让避让圆仍盖住 72px 球。`shape-outside: circle(36px …)` 朝向球（`expand-left` 时 `float: right`，`expand-right` 时 `float: left`；`expand-up` 时圆在底部，`expand-down` 时圆在顶部）加 8px `shape-margin`。与头像垂直重叠的行绕开圆，离开球的行用满胶囊宽度。字形不会画进圆里。内容超出上限后 `composer-capped` 去掉浮动，改用 `--ball` 的 `padding-inline`，滚动中的草稿仍避开头像。

高度从不先撑到 `--composer-max` 再测量：若浮动块是 `height: 100%`，那一次撑开会把 `scrollHeight` 抬到上限，几个字也会变成最高的胶囊。

回车发送；Shift+Enter 换行；输入法合成（`isComposing` 或 `keyCode` 229）不发送。粘贴只插入 `text/plain`。占位符走 `data-placeholder` 加 `.prompt-empty`，因为 contenteditable 的 `:empty` 会被 Chrome 插入的 `<br>` 打破。

## 考虑过的替代方案

**保留 `<input type="text">` 并加宽面板。** 原生 input 永不折行。把 320px 加宽后，长中文指令在一行里仍会藏字，而且 `FLOATING_PANEL_SIZE` 是 overlay-guard 的几何。

**用 `<textarea>`，统一加上等于 `--ball` 的 `padding`。** 每一行都会窄得像球旁边那一列，包括头像上方（或下方）的空区。`shape-outside` 需要 textarea 无法与圆共享的格式化上下文。

**复用 Web 的 Lexical composer。** overlay 文档仍是 `floating.html`；拉进 `ui-conversation` 会启动紧凑球不得加载的 Client 机制。

**让 Electron 窗口跟着草稿长高。** 更高的置顶 overlay 会盖住更多 Computer Use 正在驱动的桌面。高度留在 420px 面板内。

**先把 `--composer-height` 设成 `--composer-max` 再量。** 绕球浮动块曾是 `height: 100%`，这一撑会让 `scrollHeight` 等于上限，任何非空草稿都会开到极限高度。

**焦点时弹出第二块编辑器。** 胶囊里会是截断的一行，更大的框里是同一段文字。草稿出现两份。

## 后果

长粘贴在 132px 上限内滚动，不会撑大 overlay。jsdom 不能证明绕圆折行；Chromium 布局靠手工检查。`#prompt` 不再是可被 label 关联的表单控件；隐藏标签改用 `aria-labelledby`。

## 测试

`floating-renderer.spec.ts` 钉住 `contenteditable` 标记、`--composer-max`、`--prompt-pad`、胶囊与绕球浮动块上的 `--composer-height`、各展开方向的 float/`shape-outside`、封顶内边距、短草稿留在 72px、按行长高（不先撑到上限再量）、回车对 Shift+Enter 和对合成期回车、以及只粘贴 `text/plain` 不带 HTML。已有 overlay 发送路径改写 contenteditable 文本，不再写 `input.value`。
