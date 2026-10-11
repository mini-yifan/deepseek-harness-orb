---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-11-computer-use-message-source

[English](2026-10-11-computer-use-message-source.md) | 中文

## 概述

新增 computer-use 消息来源，用于桌面 GUI Agent 的观察通知；并新增 computer-use/coordinate-mode 事件，记录会话的点击编码模式。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-11-computer-use-message-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-05-working-directory-attribution"
    after: "bdf786ba936e83df0317d1eaeda50066d265ec52382992d0fa16dd5caccb681d"
    decision: same-version
  - root: "event:computer-use/coordinate-mode"
    previous: null
    after: "43c99dbb47176eec46640f2acc94ed8a23238551bfb8ec9b8507f69d95f4da94"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "97cb556c68faa3463aaf451bcf06efd5858dba73331f70043cbf1b9cb5223eb0"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-07-title-reasoning-effort"
    after: "2fdb702322fc68494e19dc17666eca7c1993b6b37fe7a36015dfbfd5864d928d"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "c85881707cc7506892c9406d5e0817601e66aa0f9a002ffbdd4f8deafb7b9d8e"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

既有日志不含该来源，保持有效。新来源是普通 user、developer 与 inbox 消息上的限定归因；不认识 dsh-experimental-tool-computer-use 的读取方会保留该消息并像处理其他插件通知一样仅依据内容推导历史。coordinate-mode 事件是每个空白 Computer Use 会话写入一次的新事件根；不认识它的读取方会忽略未知事件，且该预设之外没有生产者写入它。事件类型与会话头均不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/tool-computer-use：211 个测试通过。pnpm run test:snapshot -t computer-use 对照录制的回放夹具通过。pnpm run typecheck 通过。pnpm run doc-sync 全部门禁通过。

<a id="dev-note"></a>
## 开发备注

无。
