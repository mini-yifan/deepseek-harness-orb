# Agent Note: Computer Use 0–1000 fraction coordinates

Status: implemented

English | [中文](2026-09-15-computer-use-fraction-coordinates.zh.md)

## Problem

Computer Use maps `click` / `input_text` / `scroll` `position` as independent 0–1000 fractions of each screen's logical bounds, then posts that global point. The model-facing envelope and policy instead named attached-image pixels, logical size, and downscale multipliers toward the original capture, and told the model to convert attached pixels with those multipliers before choosing coordinates. A vision model that followed any of those pixel sizes missed obvious buttons even when the screenshot was clear.

[Experimental Computer Use](../feature/2026-09-13-experimental-computer-use.md) still owns the GUI tools, first-frame attach, and HID mapping.

## Decision

`formatScreenEnvelope` emits only `<screen_index>` and `<coordinate_space>0-1000</coordinate_space>`. It omits `<logical_size>`, `<attached_size>`, the `<content>` pixel/byte line, and all `multiply coordinates` / `downscaled from` advice. `originalDimensions` remains on the stored attachment ref; it is not model-visible on the observation.

POLICY, the first-frame notice, and the `position` parameter descriptions state that `[0, 0]` is the top-left of the visible screenshot, `[1000, 1000]` is the bottom-right, x and y scale independently, and pixel widths and other image-handle dimensions must be ignored. `mapNormalizedToGlobal` is unchanged. [Image handle omits request-preview pixels](2026-09-15-omit-request-preview-handle-dimensions.md) owns the shared handle.

## Alternatives considered

**Draw a 0–1000 grid on the request image.** A grid can help aiming but changes capture bytes, token cost, and overlay-exclude JPEG output. This cut keeps the screenshot unmodified.

**Map tool `position` from request-preview pixels.** That would couple Computer Use execute to the DeepSeek request-image projection, which is per-route and can shrink again inside the provider token solver.

**Strip `request preview WxHpx` from the global image handle.** This note owns the Computer Use envelope. [Image handle omits request-preview pixels](2026-09-15-omit-request-preview-handle-dimensions.md) removes those pixels from the shared handle. `read_image` still names original-file multipliers on its own tool result.

## Consequences

Retina capture, 2048×2048 attachment normalization, and the 1,690,000-pixel request budget still resize rasters; they are not a second coordinate space on the Computer Use observation. The shared image handle omits request-preview pixels under [Image handle omits request-preview pixels](2026-09-15-omit-request-preview-handle-dimensions.md). HID, overlay-guard, and ScreenCaptureKit capture are unchanged.

## Testing

`packages/experimental/tool-computer-use/tests/tools.spec.ts` pins the envelope to screen index plus `0-1000` even when `originalDimensions` is set, omits `logical_size`, `attached_size`, `downscaled`, `multiply`, and `px`, and pins POLICY against raw pixels and multipliers. The authored [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) fixture refreshes the first-frame notice, click-result envelope, POLICY, and `position` schema descriptions.
