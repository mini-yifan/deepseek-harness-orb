# Agent Note: Image handle omits request-preview pixel sizes

Status: implemented

English | [中文](2026-09-15-omit-request-preview-handle-dimensions.zh.md)

## Problem

Every retained vision image is preceded by a shared handle from [`requestImageHandleText`](../../../../packages/llm/llm/src/content.ts). That handle named `request preview WxHpx` next to the pixels the model sees. Computer Use maps `click` / `input_text` / `scroll` `position` as 0–1000 fractions of the visible screenshot. A vision model that treated the preview size as the click space missed on-screen controls even when the screenshot was clear.

[Computer Use 0–1000 fraction coordinates](2026-09-15-computer-use-fraction-coordinates.md) owns the Computer Use envelope and POLICY. This note owns the shared handle.

## Decision

`requestImageHandleText` names the occurrence (display name or complete attachment id) and optional normalized-object access. It omits request-preview width and height. DeepSeek and pi-ai serialization, request pricing, and replay adapters call that two-argument form.

`read_image` still prints on-disk dimensions and original-file multipliers on its own tool result. When a filesystem mapping exists, the handle's normalized-copy clause may still include the durable attachment's width, height, and media type so tools can address the file.

## Alternatives considered

**Omit the pixels only for Computer Use screenshots.** That would special-case image names or a serializer flag. Every vision adapter would have to know Computer Use, and a leftover `request preview WxHpx` on any other image in the same request would still look like a click space.

**Rewrite the sentence as “not a coordinate space” while keeping WxHpx.** The size would still sit beside the image the model is looking at.

**Draw a 0–1000 grid on Computer Use captures.** Out of scope for this cut. Screenshots stay unmodified.

## Consequences

All vision routes lose request-preview pixels on the handle, including `read_image` follow-up turns. Locating a feature on disk still uses the `read_image` envelope and, when present, the normalized-copy size. Request projection still resizes rasters under each route's pixel budget; those sizes are not a model-visible click space.

## Testing

`packages/llm/llm/tests/content.spec.ts` pins identity-plus-path handles and rejects `request preview` / preview `WxHpx` when no filesystem mapping is present. DeepSeek serialize, adapter, and request-pricing tests plus pi-ai context tests pin the same omission. The ACP image-offload expected e2e updates the wire handle. Computer Use POLICY drops “request-preview sizes” from the ignore list and the authored [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) system prompt follows it.
