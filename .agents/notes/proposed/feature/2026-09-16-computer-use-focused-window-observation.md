# Agent Note: Computer Use focused-window observation

Status: proposed

English | [中文](2026-09-16-computer-use-focused-window-observation.zh.md)

## Problem

Computer Use today captures every attached display and maps `click` / `drag` / `input_text` as 0–1000 fractions of that display's `NSScreen` logical bounds. The model therefore sees Dock, menu bar, other applications, empty wallpaper, and secondary monitors in the same image as the target UI. DeepSeek still downscales that raster into a ~1.69M-pixel request preview, so most of the vision budget is spent on pixels the next action will not touch. Aiming then becomes a fraction of the whole display: a small control in one window is a few dozen units in 0–1000 space, and first clicks systematically miss left or down even when the model has clearly recognized the control.

A coordinate grid overlaid on the screenshot, and sending a native 1920×1080 raster, do not close that gap enough to ship. Anthropic's computer-use guidance reports the same result for overlay grids. Products that look accurate on ordinary buttons (Codex, Qoder, Trae) read Accessibility trees when they can; products that can draw in Paint still use vision, but they screenshot the **target window** and map coordinates in that image, then bring a different app forward with an app-level activate/open — they do not ask the model to click the Dock inside a full-desktop shot.

The current plugin already knows which layer-0 window sits under the Desktop overlay (`inspectForeground` writes `<frontmost_app>`), but capture ignores that window's id and bounds and still shots the displays. After a window-only shot, the Dock and other apps disappear from the image, so the model also has no visual way to switch applications unless the runtime can activate or launch an app by name.

## Proposal

Change the Computer Use observation from "every attached display" to "the one frontmost application window after overlay skip". Keep the existing foreground exclusive HID loop: the agent still posts real `CGEvent` input on the user's Mac, and a person must not use that Mac while the agent runs. What changes is only what the model is allowed to see.

This note is the product and implementation contract for that cut. [Experimental Computer Use](../../implemented/feature/2026-09-13-experimental-computer-use.md) still owns the GUI tools, first-frame attach, and consent gate. [Computer Use 0–1000 fraction coordinates](../../implemented/bug-fix/2026-09-15-computer-use-fraction-coordinates.md) still owns the 0–1000 space of **the attached screenshot**. [Computer Use observation foreground](../../implemented/feature/2026-09-15-computer-use-observation-foreground.md) still owns `<frontmost_app>` / `<frontmost_folder>` / `<focus_note>`. [Desktop overlay-guard IPC](../../implemented/architecture/2026-09-14-desktop-overlay-guard.md) still owns omitting the floating ball from capture.

### Target loop

1. The user sends one Computer Use message. Before the model runs, the host captures the current frontmost operable window (overlay ids skipped) and attaches that single image plus the existing foreground envelope.
2. Every later GUI tool result recaptures the window that is frontmost **at recapture time**, not a remembered window from the previous step.
3. The model sees only that window's pixels. It does not receive other displays, the Dock, the menu bar, or sibling applications.
4. If `<frontmost_app>` or the image is not the application the user asked for, the model does not hunt the Dock. It calls an app-level activate/open tool (find a running process, or launch the app). The system brings that app to the foreground.
5. The next observation is the new frontmost window. Clicks and drags are 0–1000 of that new image, mapped through that window's global bounds.
6. Input remains foreground `CGEvent` on the real desktop. This cut does not add Codex-style background virtual cursors or PID-targeted events that leave the user's pointer free.

Worked example: WeChat is frontmost; the user asks to draw a cat in Paint. First-frame is the WeChat window. The model activates or opens Paint. Recapture is the Paint window. Subsequent `drag` strokes stay inside that window's 0–1000 space.

### What stays the same

- First-frame attach on `agent/pre-step` and recapture after each GUI tool; there is still no observe tool.
- One GUI action per tool call; `postActionWaitMs` then recapture.
- 0–1000 of the visible screenshot, independent x/y, ignore handle pixel sizes.
- Overlay window ids skipped for inspect and omitted from the image.
- macOS Screen Recording and Accessibility; production still throws on other platforms.
- Humans do not share the pointer with the agent during a run.

### Capture definition

"Frontmost window" is the first on-screen layer-0 `CGWindow` after skipping `activeCaptureExcludeWindowIds()`, the same z-order walk `inspectForeground` already uses. It is not the Accessibility focused element, and it is not "the app named in the user message".

Capture that window by id (or by a ScreenCaptureKit `SCWindow` filter), not by a display rectangle. A display-rect crop of `kCGWindowBounds` would include overlapping windows and wallpaper. Omit the window shadow (`screencapture -o` or equivalent crop): a shadow that is in the PNG but not in the bounds used by `mapNormalizedToGlobal` recreates a systematic click offset.

The attached image is that window's content. `screen_index` `0` names this single observation surface. `maxScreens` no longer means "how many displays to stitch"; a later cut may attach extra windows of the same app (palettes, menus) as additional indexes, but this cut ships one window.

### Coordinate mapping

`mapNormalizedToGlobal` must use the captured window's global logical bounds, not `NSScreen.frame`. `[0, 0]` is the top-left of the attached image; `[1000, 1000]` is the bottom-right of that same image. HID posting stays global Quartz points. If capture pixels and mapping bounds disagree (shadow, Retina scale, flipped coordinates), clicks miss the same way display-space mapping missed when the envelope mentioned request-preview pixels.

`ScreenInfo` (or a rename such as capture surface) has to carry window origin/size for mapping. `listScreens` as "all NSScreens" is the wrong list for execute once observation is window-scoped: `requireScreen` must resolve against the last observation's window bounds, or recapture bounds immediately before mapping.

### Switching the frontmost app

Window-only observation removes the Dock from the image, so POLICY that says "click the target window" is not enough. This cut adds a model-visible way to:

- list running applications the Computer Use session may target;
- activate a running app (bring its front window forward);
- launch an app by bundle id or display name when it is not running.

`open_in_browser` and `open_in_finder` stay for URLs and filesystem paths. They are not a general app switcher. After activate/open, the tool waits `postActionWaitMs` and recaptures; the new image is the new frontmost window. POLICY must tell the model: if the screenshot is the wrong app, activate or open the right one; do not click chrome that is not in the image.

### Fallback when there is no operable window

When overlay skip leaves no layer-0 owner (desktop click, Mission Control, empty Space), keep `<frontmost_app>none</frontmost_app>` and `<focus_note>`. Do not attach a full-desktop raster as a silent fallback in this cut: that would re-teach the model to aim in display space. Activate/open is how the agent acquires a window. If activate/open fails, the tool result states that failure in text plus the same fallback tags, still without a desktop panorama.

### Current code map

Read these files with the package README; they are the live observation path this proposal replaces.

| Path | What it does today | What this cut changes |
|---|---|---|
| [`packages/experimental/tool-computer-use/README.md`](../../../../packages/experimental/tool-computer-use/README.md) | Display capture, 0–1000 per screen, eleven GUI tools | Document window observation, app activate/open, and the Dock-is-invisible rule |
| [`src/observe.ts`](../../../../packages/experimental/tool-computer-use/src/observe.ts) | `listScreens` → capture each display; envelope is `screen_index` + `0-1000` | Capture the inspect window; one surface per observation |
| [`src/macos.ts`](../../../../packages/experimental/tool-computer-use/src/macos.ts) | `screencapture -R` of `NSScreen` bounds; inspect returns `appName` only | Return window id + bounds; capture by window id; SCK window filter when overlay ids are set |
| [`src/macos-sck-capture.swift`](../../../../packages/experimental/tool-computer-use/src/macos-sck-capture.swift) | Display `sourceRect` minus overlay windows | Window-targeted capture that still omits overlay ids |
| [`src/coordinates.ts`](../../../../packages/experimental/tool-computer-use/src/coordinates.ts) | 0–1000 × `screen.bounds` (the display) | 0–1000 × captured window bounds |
| [`src/backend.ts`](../../../../packages/experimental/tool-computer-use/src/backend.ts) | `ScreenInfo` is a display; `DesktopForeground` is app metadata | Capture surface is a window; foreground may include window title |
| [`src/plugin.ts`](../../../../packages/experimental/tool-computer-use/src/plugin.ts) | First-frame and recapture call `observeDesktop`; tools take `screen_index` | Same attach timing; execute maps through the window from that observation |
| [`src/policy.ts`](../../../../packages/experimental/tool-computer-use/src/policy.ts) | Trust attached desktop screenshots; click to focus when `<focus_note>` | Trust the frontmost-window screenshot; activate/open when the app is wrong |
| [`src/overlay-guard.ts`](../../../../packages/experimental/tool-computer-use/src/overlay-guard.ts) | Cloak capture/HID; pass overlay ids into inspect and SCK | Window capture should not include the ball; still skip those ids in the z-order walk |

### Out of scope for this cut

- Accessibility `click_element` / numbered AX trees (Codex's button path). Window observation is still vision + `CGEvent`.
- Background / virtual-cursor Computer Use that leaves the human pointer free.
- Overlay aiming grids, letterbox rulers, or forcing a 1920×1080 request image.
- Stitching menus, sheets, and floating palettes into the main window image. Those are separate CGWindows; if a later cut needs them, attach them as extra same-app surfaces, not as a return to full-desktop capture.
- Windows/Linux production backends.

## Alternatives considered

**Keep full-desktop capture and add a grid.** Live eval on DeepSeek Flash did not improve real dense UI enough to ship, and overlay lines occlude controls. Anthropic reports overlay grids as unreliable. The miss is often "wrong region of the desktop", which a grid cannot fix.

**Send native 1920×1080 display pixels.** The DeepSeek request path still caps vision tokens (~1.69M pixels, then a 1024-token cap). Extra encoded pixels do not become extra visible detail, and the coordinate space stays the whole display.

**AX-only observation (no screenshot).** Drawing in Paint, canvas tools, and games have no useful AX nodes for strokes. Codex still screenshots and `drag`s for those tasks. This cut keeps screenshots and narrows them to the frontmost window.

**Codex-style background PID events and a virtual cursor.** The requested product stays foreground exclusive: the real pointer moves, and the human does not use the Mac during the run. Window observation does not require background delivery.

**Display-rect crop of the frontmost window bounds.** Faster to wire onto today's `screencapture -R`, but any overlapping window or desktop chrome inside that rectangle appears in the image while mapping assumes the target window owns every pixel.

**Silent full-desktop fallback when inspect fails.** That would mix two coordinate spaces in one session and teach the model to click Dock icons again.

## Acceptance criteria

- First user turn and every GUI tool result attach exactly one screenshot of the overlay-skipped frontmost layer-0 window, plus the existing foreground tags. No display panorama is in model-visible content.
- `click` / `drag` / `input_text` / `scroll` / `long_press` map 0–1000 through that window's global bounds. A control in the attached image receives the click inside its visible box, not at the same fraction of the display.
- Shadow, scale, and flipped-coordinate disagreement between PNG and mapping bounds is treated as a product bug, not as model error.
- When the frontmost app is not the task target, the model can activate a running app or launch it without seeing the Dock; the next image is that app's frontmost window.
- Overlay chrome is absent from the window screenshot. `<frontmost_app>` still skips overlay ids and can name the Desktop main window when that window is next in z-order.
- Empty frontmost state uses `<focus_note>` and does not attach a full-desktop image.
- Package tests and the authored [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) scenario pin the single-window envelope, activate/open, and POLICY. Fake backends return one window-sized fixture, not one image per display.
- Desktop overlay-guard still cloaks HID. Window capture on Darwin still works when overlay ids are present (SCK window filter or equivalent), with no `screencapture` fallback that would reintroduce the ball.

## Risks

The model cannot see other windows, so it cannot click a dialog that belongs to a different process, nor a menu that is a separate CGWindow above the captured window. Activate/open plus recapture is the recovery path; some UI will need a follow-up that captures transient windows.

A tiny focused inspector panel becomes the entire observation if it is the frontmost layer-0 window. The model may then activate the main document window of the same app; the activate tool must be able to target that app, not only "whatever is focused".

Wrong-app first frames cost a turn. That is accepted: the user may have WeChat focused while asking for Paint.

Foreground exclusive control is unchanged and remains unsafe on a shared Mac. Narrowing the screenshot does not add a human-usable pointer during the run.
