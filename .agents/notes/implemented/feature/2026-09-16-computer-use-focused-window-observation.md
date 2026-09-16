# Agent Note: Computer Use focused-window observation

Status: implemented

English | [中文](2026-09-16-computer-use-focused-window-observation.zh.md)

## Problem

Computer Use captured every attached display and mapped `click` / `drag` / `input_text` as 0–1000 fractions of that display's `NSScreen` logical bounds. The model therefore saw Dock, menu bar, other applications, empty wallpaper, and secondary monitors in the same image as the target UI. DeepSeek still downscales that raster into a ~1.69M-pixel request preview, so most of the vision budget is spent on pixels the next action will not touch. Aiming then becomes a fraction of the whole display: a small control in one window is a few dozen units in 0–1000 space, and first clicks systematically miss left or down even when the model has clearly recognized the control.

A coordinate grid overlaid on the screenshot, and sending a native 1920×1080 raster, do not close that gap enough to ship. Anthropic's computer-use guidance reports the same result for overlay grids. Products that look accurate on ordinary buttons (Codex, Qoder, Trae) read Accessibility trees when they can; products that can draw in Paint still use vision, but they screenshot the **target window** and map coordinates in that image, then bring a different app forward with an app-level activate/open — they do not ask the model to click the Dock inside a full-desktop shot.

The plugin already knew which layer-0 window sat under the Desktop overlay (`inspectForeground` writes `<frontmost_app>`), but capture ignored that window's id and bounds and still shot the displays. After a window-only shot, the Dock and other apps disappear from the image, so the model also has no visual way to switch applications unless the runtime can activate or launch an app by name.

## Decision

Computer Use observation is the one frontmost application window after overlay skip. The existing foreground exclusive HID loop is unchanged: the agent still posts real `CGEvent` input on the user's Mac, and a person must not use that Mac while the agent runs. What changed is only what the model is allowed to see.

[Experimental Computer Use](2026-09-13-experimental-computer-use.md) still owns the GUI tools, first-frame attach, and consent gate. [Computer Use 0–1000 fraction coordinates](../bug-fix/2026-09-15-computer-use-fraction-coordinates.md) still owns the 0–1000 space of **the attached screenshot**. [Computer Use observation foreground](2026-09-15-computer-use-observation-foreground.md) still owns `<frontmost_app>` / `<frontmost_folder>` / `<focus_note>` (this cut adds optional `<frontmost_window>`). [Desktop overlay-guard IPC](../architecture/2026-09-14-desktop-overlay-guard.md) still owns omitting the floating ball from capture.

`inspectForeground` walks on-screen layer-0 `CGWindow`s after skipping `activeCaptureExcludeWindowIds()` and returns `windowId`, global logical bounds, optional `windowTitle`, and the containing `NSScreen` backing scale. JXA binds `CGWindowListCopyWindowInfo` as returning `id` so `ObjC.deepUnwrap` is an array; unbound, the unwrap is a non-array, the walk finds nothing, and the model gets focus tags with no screenshot. Remaining windows with an edge below 64pt are skipped so titlebar-sized chrome does not become the screenshot. `listScreens` is that one surface: 0 or 1 `ScreenInfo` (`index` is always 0; `bounds` are the window, or the window union open menus). `wrapDesktopBackend` runs `listScreens` inside `withCapture` so exclude ids are live; otherwise an empty exclude list would treat the floating ball as the frontmost window.

Capture is by window id when no popup is open. With no overlay ids the backend runs `screencapture -x -o -t jpg -l <windowId>` (`-o` omits the shadow). With overlay ids it runs only the ScreenCaptureKit helper with `--window=` and `SCContentFilter(desktopIndependentWindow:)`; there is no `screencapture -R` fallback for that path. The helper starts `NSApplication` on the main actor with activation policy `.prohibited` before that filter; a CLI `@main` task otherwise hits CoreGraphics `CGS_REQUIRE_INIT`. Open menus are owned by [Computer Use transient window observation](2026-09-16-computer-use-transient-window-observation.md). Execute remaps 0–1000 through the current observation bounds via existing `mapNormalizedToGlobal`. `screen_index` is 0 for this surface. `maxScreens` is removed.

`list_apps` lists `activationPolicy === regular` display names. `open_app` takes a display name or bundle id: a running match is `NSRunningApplication.activateWithOptions_(NSApplicationActivateIgnoringOtherApps)`; otherwise `/usr/bin/open -a` / `-b` launches it. Short `open -a` is not the activate path for an already-running app. Ambiguous or failed activate returns tool-result text plus the same focus tags and does not attach a desktop panorama.

When overlay skip leaves no layer-0 owner, the observation is `<frontmost_app>none</frontmost_app>` plus `<focus_note>` with no screenshot. POLICY tells the model: trust only the attached frontmost-window screenshot; if the app is wrong, call `list_apps` / `open_app`; do not click the Dock. Large windows still downscale to the existing ~1.69M-pixel request budget; small windows stay at capture size.

This cut does not add Accessibility `click_element`, background virtual cursors, overlay aiming grids, or Windows/Linux production backends.

## Alternatives considered

**Keep full-desktop capture and add a grid.** Live eval on DeepSeek Flash did not improve real dense UI enough to ship, and overlay lines occlude controls. Anthropic reports overlay grids as unreliable. The miss is often "wrong region of the desktop", which a grid cannot fix.

**Send native 1920×1080 display pixels.** The DeepSeek request path still caps vision tokens (~1.69M pixels, then a 1024-token cap). Extra encoded pixels do not become extra visible detail, and the coordinate space stays the whole display.

**AX-only observation (no screenshot).** Drawing in Paint, canvas tools, and games have no useful AX nodes for strokes. Codex still screenshots and `drag`s for those tasks. This cut keeps screenshots and narrows them to the frontmost window.

**Codex-style background PID events and a virtual cursor.** The requested product stays foreground exclusive: the real pointer moves, and the human does not use the Mac during the run. Window observation does not require background delivery.

**Display-rect crop of the frontmost window bounds.** Faster to wire onto `screencapture -R`, but any overlapping window or desktop chrome inside that rectangle appears in the image while mapping assumes the target window owns every pixel.

**Silent full-desktop fallback when inspect fails.** That would mix two coordinate spaces in one session and teach the model to click Dock icons again.

## Consequences

The model cannot see other windows, so it cannot click a dialog that belongs to a different process. Open menus of the captured window are included by [Computer Use transient window observation](2026-09-16-computer-use-transient-window-observation.md). Activate/open plus recapture is the recovery path for a window in another app.

A focused inspector panel that is at least 64pt on each edge becomes the entire observation if it is the frontmost remaining layer-0 window. The model may then activate the main document window of the same app; `open_app` targets that app by name, not only "whatever is focused".

Wrong-app first frames cost a turn. That is accepted: the user may have WeChat focused while asking for Paint.

Foreground exclusive control is unchanged and remains unsafe on a shared Mac. Narrowing the screenshot does not add a human-usable pointer during the run.

## Testing

Package tests pin the single-window envelope, empty frontmost without a panorama, window-bounds mapping, `screencapture -l -o`, SCK `--window=` with no `screencapture` fallback when overlay ids are set, AppKit main-actor init in the helper, `list_apps` / `open_app`, activate-failure text, and `ObjC.bindFunction` so the inspect script unwraps `CGWindowListCopyWindowInfo` as an array. Overlay-guard tests run `listScreens` inside `withCapture` and `openApp` inside `withInput`. The authored [`snapshots/session/computer-use/`](../../../../snapshots/session/computer-use/) scenario pins POLICY, the first-frame window notice, the click envelope, the fake single-window fixture, and the new tool schemas.
