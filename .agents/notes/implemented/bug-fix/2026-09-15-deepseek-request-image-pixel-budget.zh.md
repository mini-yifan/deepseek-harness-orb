# Agent Note: DeepSeek 请求图片像素预算对齐提供方 1300×1300 上限

Status: implemented

[English](2026-09-15-deepseek-request-image-pixel-budget.md) | 中文

## 问题

harness 把每张 DeepSeek 视觉请求图片投影到总计 640,000 像素。Flash 视觉大约按 1300×1300 总像素处理，然后把单张图片封顶在 1024 token。因此 Computer Use 截屏和其他视觉附件会丢掉模型本可利用的界面细节；典型 16:10 笔记本预览大约是 992×645。

## 决策

`DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET` 为 1,690,000（1300×1300）。catalog 模型 `deepseek-flash` 和 `deepseek-v4-flash-vision-exp` 继承该省略默认值。16:10 的 Computer Use 截屏在 2048×2048 附件规范化之后大约投影为 1612×1047。2048×1024 的规范化附件投影为 1838×919。附件规范化和 `imageMaxBytes`（1 MiB）不变。

该预算按 catalog 模型生效，不按 agent preset。Computer Use 使用 `deepseek-flash`，因此只给 Computer Use 覆盖仍会改变该路由上的每个会话。

不要把默认值提高到 1,690,000 以上：提供方的 v41 求解器随后会把光栅缩小到 1024 token 上限附近，多编码的像素不会变成多看到的细节。

[v41 图片 token 计算器](2026-09-10-deepseek-image-token-calculator-v41.zh.md) 仍拥有对实际发送光栅的计价。

## 考虑过的替代方案

**保持 640,000，只提高 Computer Use。** `imagePixelBudget` 是 catalog 模型字段。悬浮球和普通视觉会话共用 `deepseek-flash`。再加一个模型 id 会拆开路由，却不改变提供方能看到的内容。

**随请求预算一起提高附件的 `normalizedImageMaxPixels`。** 2048×2048（4,194,304）已经超过 1,690,000，因此请求投影仍是模型可见上限。

**原样发送 Retina 截屏。** 提供方在约 1300×1300 处按 token 封顶。更大的文件占用 Files 配额和请求字节，却不增加已处理细节。

## 影响

每张曾使用旧的 640,000 像素默认值的保留图片现在消耗更多视觉 token（16:10 截屏从大约 400 升向 1024 上限）。截屏密集的 Computer Use 会话会更早触发压缩（compaction）。`imagePixelBudget: 'low'` 仍为 512×512。无需密钥的 `llm-replay` fixture 仍声明 `imageRequestTokens`，不受影响。

## 测试

`packages/llm/llm-deepseek/tests/adapter.spec.ts` 把省略模型策略钉在 1,690,000 像素。`request-pricing.spec.ts` 把 1920×1080 源图钉为 1733×975 / 968 token。
