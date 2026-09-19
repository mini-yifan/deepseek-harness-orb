# Agent Note: Computer Use same-step GUI calls

Status: implemented

[English](2026-09-19-computer-use-same-step-gui-calls.md) | 中文

## 问题

Computer Use 政策要求模型每次工具调用只做一次 GUI 动作，并且不要在同一步里组合 GUI 工具。因此在静止画布上点四下再按热键，会多付四轮视觉往返。宿主已经会把互斥的兄弟调用在同一条 assistant 步里串行，并给每个结果附上截图。

## 决策

[`policy.ts`](../../../../packages/experimental/tool-computer-use/src/policy.ts) 里的 Step 文案允许模型在同一步发出多个 GUI 工具调用，条件是每个目标都已经出现在最新截图上，且后面的调用不需要前面调用才创造出来的 UI。宿主按顺序执行这些调用。每个结果带自己动作后的截图；该步之后，任何依赖画面变化的动作使用最后一张图。目标只在同一步里更早动作之后才出现（菜单、对话框、新页面、加载器）的单击、输入或热键，仍放到后续步。

GUI 工具仍是 `isConcurrencySafe: () => false`。`execute`、`guiTurn`、overlay-guard 与 `withGuiTurn` 仍包住一次动作及其重新截屏。面向模型的描述不再写 `Exclusive` 或 `do not combine`；该分类器只给宿主。[实验性 Computer Use](2026-09-13-experimental-computer-use.zh.md) 仍拥有插件、十三个 GUI 工具，以及一次动作再重新截屏的路径。

## 考虑过的替代方案

**把重新截屏合并到最后一个兄弟调用。** 那会跳过中间捕获和图片 token，但会改 execute、`withGuiTurn` 以及每个调用自带截图的结果。本轮保持每次调用都重新截屏。

**把 `click` 标成 parallel-safe。** 一个指针和一次 overlay 遮蔽不能重叠 HID。互斥调度已经会把同一步的兄弟调用排队。

**保持每步一次 GUI 调用。** 那能避免过期坐标的批次，但静止画布上的额外视觉往返也会留下。

## 影响

一批调用里第二次需要第一次才创造出来的控件时会点空。下一轮模型请求在压缩之前会带上每个兄弟调用各一张图。HID 稳定等待 `postActionWaitMs` 仍在每次调用之后运行。

## 测试

包测试钉住 Step 措辞、千分比与像素 `click` 描述不含 `Exclusive` / `do not combine`、保持 `executionMode` exclusive，并让两次同一步 `click` 走 agent loop：假桌面 HID 有序、两个带图的 `tool/result`，以及下一轮请求里的两张图。Headless snapshot sidecar 钉住系统提示的 Step 段与工具 schema 描述。

## 延期

后续可以在同一步 burst 上保持 overlay 点击穿透，并只在最后一个 GUI 调用之后重新截屏。那不是本决策。
