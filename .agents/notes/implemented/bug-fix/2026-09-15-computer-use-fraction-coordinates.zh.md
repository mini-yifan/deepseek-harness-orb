# Agent Note: Computer Use 0–1000 比例坐标

Status: implemented

[English](2026-09-15-computer-use-fraction-coordinates.md) | 中文

## 问题

Computer Use 把 `click` / `input_text` / `scroll` 的 `position` 按每屏逻辑边界上相互独立的 0–1000 比例映射，再发送该全局点。面向模型的信封和策略却标出附件像素、逻辑尺寸，以及指向原始捕获的缩放倍率，并让模型在选坐标前用这些倍率转换附件像素。视觉模型只要跟着其中任一像素尺寸走，就会在截图已经清楚时打偏明显按钮。

[实验性 Computer Use](../feature/2026-09-13-experimental-computer-use.zh.md) 仍拥有 GUI 工具、首帧附加和 HID 映射。

## 决策

`formatScreenEnvelope` 只发出 `<screen_index>` 和 `<coordinate_space>0-1000</coordinate_space>`。它省略 `<logical_size>`、`<attached_size>`、`<content>` 像素/字节行，以及所有 `multiply coordinates` / `downscaled from` 说明。`originalDimensions` 仍留在已存储的附件引用上；观察里不对模型可见。

POLICY、首帧通知和 `position` 参数描述写明：`[0, 0]` 是可见截图左上角，`[1000, 1000]` 是右下角，x 与 y 独立缩放，并且必须忽略像素宽度和其他图片句柄尺寸。`mapNormalizedToGlobal` 不变。[图片句柄省略请求预览像素](2026-09-15-omit-request-preview-handle-dimensions.zh.md) 拥有共用句柄。

## 考虑过的替代方案

**在请求图片上叠 0–1000 网格。** 网格能辅助瞄准，但会改变捕获字节、token 成本和 overlay 排除 JPEG 输出。本轮保持截图不被修改。

**按请求预览像素映射工具 `position`。** 这会把 Computer Use 的 execute 绑到 DeepSeek 请求图片投影上，而该投影按路由变化，并可能在提供方 token 求解器里再次缩小。

**从全局图片句柄去掉 `request preview WxHpx`。** 本说明拥有 Computer Use 信封。[图片句柄省略请求预览像素](2026-09-15-omit-request-preview-handle-dimensions.zh.md) 从共用句柄去掉这些像素。`read_image` 仍在自己的工具结果上标出原文件倍率。

## 影响

Retina 捕获、2048×2048 附件规范化，以及 1,690,000 像素请求预算仍会缩放栅格；它们不是 Computer Use 观察上的第二套坐标系。共用图片句柄按[图片句柄省略请求预览像素](2026-09-15-omit-request-preview-handle-dimensions.zh.md)省略请求预览像素。HID、overlay-guard 和 ScreenCaptureKit 捕获不变。

## 测试

`packages/experimental/tool-computer-use/tests/tools.spec.ts` 把信封钉成屏幕序号加 `0-1000`（即使设置了 `originalDimensions`），省略 `logical_size`、`attached_size`、`downscaled`、`multiply` 和 `px`，并把 POLICY 钉成禁止原始像素和倍率。人工编写的 [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) fixture 会刷新首帧通知、click 结果信封、POLICY 以及 `position` schema 描述。
