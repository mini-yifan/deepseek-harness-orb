# Agent Note: 图片句柄省略请求预览像素

Status: implemented

[English](2026-09-15-omit-request-preview-handle-dimensions.md) | 中文

## 问题

每张保留的视觉图片前都有 [`requestImageHandleText`](../../../../packages/llm/llm/src/content.ts) 生成的共用句柄。该句柄会在模型看见的像素旁写上 `request preview WxHpx`。Computer Use 把 `click` / `input_text` / `scroll` 的 `position` 映射为可见截图上的 0–1000 比例。视觉模型一旦把预览尺寸当成点击空间，就会在截图已经清楚时打偏屏幕上的控件。

[Computer Use 0–1000 比例坐标](2026-09-15-computer-use-fraction-coordinates.zh.md) 拥有 Computer Use 信封和 POLICY。本说明拥有共用句柄。

## 决策

`requestImageHandleText` 写出出现项（显示名或完整附件 id）以及可选的规范化对象访问。它省略请求预览宽高。DeepSeek 与 pi-ai 的序列化、请求计价和回放适配器都调用这个双参数形式。

`read_image` 仍在自己的工具结果上打印磁盘尺寸和原文件倍率。存在文件系统映射时，句柄的规范化副本子句仍可带上持久附件的宽、高和媒体类型，以便工具寻址该文件。

## 考虑过的替代方案

**只给 Computer Use 截图省略这些像素。** 那会特判图片名或序列化标志。每条视觉适配器都得认识 Computer Use，而且同一请求里其他图片若仍带着 `request preview WxHpx`，看起来仍像点击空间。

**改写成“这不是坐标系”，但仍保留 WxHpx。** 该尺寸仍会紧挨模型正在看的图。

**在 Computer Use 捕获上叠 0–1000 网格。** 本轮范围之外。截图保持不被修改。

## 影响

所有视觉路由的句柄都不再带请求预览像素，包括 `read_image` 的后续回合。在磁盘上定位特征仍使用 `read_image` 信封，以及（若存在）规范化副本尺寸。请求投影仍会按各路由的像素预算缩放栅格；这些尺寸不是模型可见的点击空间。

## 测试

`packages/llm/llm/tests/content.spec.ts` 钉住身份加路径的句柄，并在没有文件系统映射时拒绝 `request preview` / 预览 `WxHpx`。DeepSeek 的 serialize、adapter、request-pricing 测试以及 pi-ai context 测试钉住同一省略。ACP image-offload 期望 e2e 更新线上句柄。Computer Use POLICY 从忽略列表中去掉 “request-preview sizes”，人工编写的 [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) 系统提示词跟随该文本。
