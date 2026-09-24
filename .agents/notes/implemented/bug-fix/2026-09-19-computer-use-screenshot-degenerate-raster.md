# Agent Note: Computer Use skips degenerate screenshot rasters

Status: implemented

English | [中文](2026-09-19-computer-use-screenshot-degenerate-raster.zh.md)

## Problem

`screenshot` writes the same capture to Desktop, the clipboard, `DSH_HOME` attachments, and the model. A 1×1 PNG (the fake-desktop fixture) or a 1-pixel overlay crop previews as a solid-color block. Color-based rejection would false-positive on a real red UI. Policy also told the model not to call `screenshot` merely to see the window, so it could not refresh after bash, search, or web_fetch.

## Decision

`screenshot` probes PNG IHDR and JPEG SOF for intrinsic pixel size. When parse fails or either edge is below 2 px, execute skips `saveImage`, Desktop write, clipboard copy, and `rememberObservation`, and returns `isError` text that names retry via `screenshot`, `wait`, or `open_app`, plus foreground tags and no image blocks. Click, wait, and first-frame keep today's `observeDesktop` persist-all path so 1×1 fixtures still train pixel mapping.

`observeDesktop` accepts optional `persistCapture`; `screenshot` passes `isUsableObservationRaster` and does not use `recapture()`. Policy and the tool description allow `screenshot` after bash, search, or web_fetch, and forbid a repeat after click, type, wait, or open. Successful export remains Desktop plus clipboard. [Computer Use screenshot export](../feature/2026-09-15-computer-use-screenshot.md) still owns that export.

## Alternatives considered

**Reject by redness or a solid-color histogram.** A real red window would be dropped.

**Skip only the Desktop file and still attach the raster to the model.** The model and the Desktop file share one `capture()`; attaching junk would keep the bad pixel raster in `rememberObservation`.

**Raise the minimum to a larger window size.** 2×2 is the smallest size that is not a 1-pixel overlay or fixture; a real tiny control can still export.

**Change click, wait, and first-frame too.** Those tools need a persistable observation for click mapping; only `screenshot` is an export.

## Consequences

A 1×1 or unreadable `screenshot` capture never appears on Desktop, the clipboard, or attachments. The last good observation raster stays in session memory. Models may call `screenshot` after bash to look.

## Testing

`tests/raster.spec.ts` pins the 1×1 fixture, a 3×3 PNG, a 2×2 JPEG, and garbage. Plugin tests spy Desktop write: default fake `screenshot` is `isError` with no clipboard; a 3×3 PNG still writes. `observe.spec.ts` pins `persistCapture: () => false`. Pixel-mode click mapping attaches via `wait`. Authored snapshots pin policy and the `screenshot` schema.
