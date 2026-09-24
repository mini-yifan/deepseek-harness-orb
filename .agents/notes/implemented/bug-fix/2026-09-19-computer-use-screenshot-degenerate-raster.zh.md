# Agent Note: Computer Use 跳过退化截图栅格

Status: implemented

[English](2026-09-19-computer-use-screenshot-degenerate-raster.md) | 中文

## 问题

`screenshot` 把同一次捕获写到桌面、剪贴板、`DSH_HOME` 附件和模型。1×1 PNG（假桌面夹具）或 1 像素 overlay 裁切在预览里会变成色块。按颜色拒绝会把真实红色界面误杀掉。策略还要求模型不要只为看窗口而调用 `screenshot`，因此 bash、search 或 web_fetch 之后无法刷新。

## 决策

`screenshot` 用 PNG IHDR 和 JPEG SOF 探固有像素尺寸。解析失败或任一边不足 2 px 时，execute 跳过 `saveImage`、桌面写入、剪贴板复制和 `rememberObservation`，并返回 `isError` 文本，指明用 `screenshot`、`wait` 或 `open_app` 重试，附带前台标签且没有图片块。click、wait 和首帧仍走今天的 `observeDesktop` 全量持久化路径，好让 1×1 夹具继续训练像素映射。

`observeDesktop` 接受可选的 `persistCapture`；`screenshot` 传入 `isUsableObservationRaster`，不走 `recapture()`。策略和工具描述允许在 bash、search 或 web_fetch 之后调用 `screenshot`，并禁止在 click、type、wait 或 open 之后再调一次。成功导出仍是桌面加剪贴板。[Computer Use 截图导出](../feature/2026-09-15-computer-use-screenshot.zh.md) 仍拥有该导出。

## 考虑过的替代方案

**按红色或纯色直方图拒绝。** 真实红色窗口会被丢掉。

**只跳过桌面文件，仍把栅格附给模型。** 模型和桌面文件共用一次 `capture()`；附上垃圾会把坏的像素栅格留在 `rememberObservation` 里。

**把下限提到更大窗口。** 2×2 是排除 1 像素 overlay 或夹具后的最小尺寸；真实的小控件仍可导出。

**连 click、wait 和首帧一起改。** 那些工具需要可持久化的观察来做点击映射；只有 `screenshot` 是导出。

## 影响

1×1 或无法解析的 `screenshot` 捕获从不会出现在桌面、剪贴板或附件上。会话内存里仍保留上次可用的观察栅格。模型可以在 bash 之后调用 `screenshot` 来看窗口。

## 测试

`tests/raster.spec.ts` 钉住 1×1 夹具、3×3 PNG、2×2 JPEG 和垃圾字节。插件测试 spy 桌面写入：默认假 `screenshot` 为 `isError` 且不写剪贴板；3×3 PNG 仍会写入。`observe.spec.ts` 钉住 `persistCapture: () => false`。像素模式点击映射经 `wait` 附加。人工 snapshot 钉住策略和 `screenshot` schema。
