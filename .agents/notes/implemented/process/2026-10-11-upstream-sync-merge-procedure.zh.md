# Agent Note：DeepSeek Orb fork 的上游同步合并流程

Status: implemented

English | [中文](2026-10-11-upstream-sync-merge-procedure.md)

## Problem

本仓库在承载 DeepSeek Orb 产品的同时持续合并 `upstream/master`（deepseek-ai/deepseek-harness）。fork 基线之后的第一次合并涉及 1729 个上游提交、58 个冲突文件。其中若干冲突在每次同步都会重现：上游重写共享的 Electron 壳文件（main.ts、host-process.ts、桌面打包脚本）、webserver，以及产品行为触及的每个测试夹具与期望输出文件。若临时拼凑式地解决这些冲突，就会丢掉悬浮球、破坏其快照，或让仓库门禁变红却看不出原因。

## Decision

在专用分支上以 `git merge --no-ff upstream/master` 合并，然后按「以上游文件为基底、用 `git apply -3` 重贴 fork 增量」的方式解决冲突，使上游的重构得以保留，同时 fork 的新增落在其上。fork 的新增是结构性的：`apps/desktop/src/floating-*`、`orb-*`、`selection-toolbar-*`、`observation-frame-window`、`tcc.ts`、`millifraction-coordinates*`，以及 `packages/experimental/tool-computer-use` —— 上游从不触碰这些路径，所以这些位置出现冲突只意味着周边上下文发生了移动。

本次合并确立的规则及其存在理由：

- **语义冲突需要双方，而不是某一方。** `webserver` 保留上游的 TLS 与 host 校验，加上 fork 的 `listen: false` / `dispatch` 载体。`session-controller` 在上游的后台默认持久化之上保留 `saveAsDefault` 退出开关；球的模型选择绝不能覆盖部署默认值。`ui-chat` 的 `TranscriptViewPolicy` 第二参取上游的 `defaultMode`，第三参取 fork 的 `forceCompact`。
- **产品文案保持 DeepSeek Orb。** locale 字符串、测试夹具、期望菜单、对话框与快照都使用 fork 的产品名；仅当 fork 没有对应文案时才采用上游文本。
- **测试所假设的行为是承重的。** activate 处理器保留上游的 `hasVisibleWindows` 恢复逻辑与 fork 的光标的球面逻辑；`main-startup.spec.ts` 里的假 `BrowserWindow` 保留上游可 mock 的常量 `getBounds`，因为上游的窗口尺寸测试依赖它。
- **冻结的产物整体胜出。** 跨双方树配对的已归档 Agent Note 恢复为上游的密封内容；归档笔记永不合并。
- **夹具文件是输入，不是输出。** headless computer-use 快照的 `cordis.yml`、`cordis.snapshot.yml`、`session.v3.jsonl`、`system-prompt.expected.md` 与 `tool-schemas.expected.json` 跟随上游当前行为：禁用更名后的 `llm-deepseek-api-key` 行、移除已删除的 `{{cwd}}` 语句，并接受 working-directory 运行时上下文段、已声明的 computer-use 消息来源，以及重新生成的工具 schema。
- **先重新生成，再重新记录。** 解决冲突后运行 `pnpm run clean`、完整安装、`pnpm run typecheck`、各 `gen-*` 目录脚本、`pnpm run verify-translation-pairing --write <变更的文档>` 与 `pnpm run doc-sync`；fork 的 sidecar 使用上游当前的记录格式，其生成器拥有 stderr 层面可见的目录。
- **同步吸收的破坏性变更要在当前版本目录写升级指南。** llm-deepseek 提供方拆分与终端工具包更名上游都没有写。

## Alternatives considered

拒绝把 fork rebase 到上游：那会重写 106 个 orb 提交、破坏公开的 fork 历史，且仓库对独立分支偏好 merge-forward。拒绝整体取 fork 一侧来解决冲突：上游的 Electron 壳重构（托盘、退出确认、设置、登录 shell 环境、包管理器参数）正是 fork 产品现在运行的基础。拒绝把既有的红色门禁当作合并损伤：每一项都先验证过与合并前逐字节一致。

## Consequences

后续的上游同步沿用同一流程：在专用分支上 merge-forward、以上游为基解冲突、重新生成目录、重录配对 sidecar，并在跑门禁前重新对齐 fork 的夹具。每次同步都对照上游当前行为复查 fork 的新增，而不是假定上次的解法依然成立。

## Status

合并以 `merge(upstream): sync with deepseek-harness v0.2.1-alpha.2, keep the DeepSeek Orb floating ball` 落在 `main` 上（2026-10-11）。fork 既有的失败记录在交付说明中，不做静默修复：`apps/desktop-host/tests/overlay.spec.ts` 期待一个已放弃的 `config/desktop.cordis.patch.yml` overlay，而实际发布的设计通过 web-app patch 注册 `ui-settings-orb`；`apps/desktop/tests/development-plugin-store.spec.ts` 期待进程内市场改造前的链接布局。`pnpm run lint` 报告 150 个 fork 自有文件中既有的错误。
