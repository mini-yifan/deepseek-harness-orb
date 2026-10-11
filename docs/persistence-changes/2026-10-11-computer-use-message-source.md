---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-11-computer-use-message-source

English | [中文](2026-10-11-computer-use-message-source.zh.md)

## Summary

Adds a qualified computer-use message source for the desktop GUI agent's observation notices, and a computer-use/coordinate-mode event recording the session's click-encoding mode.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing logs contain no such source and remain valid. The new source is qualified attribution on ordinary user, developer, and inbox messages; readers without dsh-experimental-tool-computer-use preserve the message and derive history from its content, exactly as for any other plugin notice. The coordinate-mode event is a new root written once per blank Computer Use session; readers that do not know it ignore an unknown event, and no producer writes it outside that preset. No event type or Session header changes.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/tool-computer-use: 211 tests passed. pnpm run test:snapshot -t computer-use passed against the recorded replay fixture. pnpm run typecheck passed. pnpm run doc-sync passed all gates.

<a id="dev-note"></a>
## Dev Note

None.
