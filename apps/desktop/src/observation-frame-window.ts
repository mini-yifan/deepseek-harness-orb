/** macOS Computer Use observation-frame overlay geometry and BrowserWindow construction. */

import { BrowserWindow, screen } from 'electron'

/** Stroke width painted on `#frame`; keep in sync with renderer CSS `#frame` padding. */
export const OBSERVATION_FRAME_STROKE_PX = 4

/** Gutter around the stroke so `filter: drop-shadow` is not clipped by the window. Keep in sync with `body` padding. */
export const OBSERVATION_FRAME_GLOW_PX = 12

/** Logical points the frame window extends past each edge of the observation rectangle. */
export const OBSERVATION_FRAME_OUTSET = OBSERVATION_FRAME_STROKE_PX + OBSERVATION_FRAME_GLOW_PX

/** macOS `setAlwaysOnTop` level shared with the floating overlay and selection toolbar. */
export const OVERLAY_ALWAYS_ON_TOP_LEVEL = 'floating' as const

/** Keep the ribbon below the floating overlay (`FLOATING_OVERLAY_ALWAYS_ON_TOP_RELATIVE`). */
export const OBSERVATION_FRAME_ALWAYS_ON_TOP_RELATIVE = 0

/** Floating overlay and selection toolbar sit above the observation-frame ribbon. */
export const FLOATING_OVERLAY_ALWAYS_ON_TOP_RELATIVE = 1

interface OverlayRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function workAreaOf(point: { readonly x: number; readonly y: number }): OverlayRect {
  return screen.getDisplayNearestPoint({
    x: Math.round(point.x),
    y: Math.round(point.y),
  }).workArea
}

/**
 * Inflate the observation union so the stroke and glow sit just outside it, then clamp to the display work area.
 * @param region - Computer Use `ScreenInfo.bounds` in global logical points.
 * @param workArea - containing display work area.
 * @returns Electron window bounds.
 */
export function observationFrameBounds(
  region: OverlayRect,
  workArea: OverlayRect = workAreaOf({
    x: region.x + region.width / 2,
    y: region.y + region.height / 2,
  }),
): OverlayRect {
  const inflated = {
    x: Math.round(region.x - OBSERVATION_FRAME_OUTSET),
    y: Math.round(region.y - OBSERVATION_FRAME_OUTSET),
    width: Math.max(1, Math.round(region.width + OBSERVATION_FRAME_OUTSET * 2)),
    height: Math.max(1, Math.round(region.height + OBSERVATION_FRAME_OUTSET * 2)),
  }
  const x = clamp(inflated.x, workArea.x, workArea.x + workArea.width - 1)
  const y = clamp(inflated.y, workArea.y, workArea.y + workArea.height - 1)
  return {
    x,
    y,
    width: Math.max(1, Math.min(inflated.width, workArea.x + workArea.width - x)),
    height: Math.max(1, Math.min(inflated.height, workArea.y + workArea.height - y)),
  }
}

/**
 * Construct the hollow observation-frame panel. The caller loads `dsh-app://shell/observation-frame.html`.
 * Always click-through: Computer Use HID must hit the target app, not this chrome.
 * @returns a hidden, non-activating overlay.
 */
export function createObservationFrameWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1,
    height: 1,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    type: 'panel',
    show: false,
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  window.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, OBSERVATION_FRAME_ALWAYS_ON_TOP_RELATIVE)
  window.setIgnoreMouseEvents(true, { forward: true })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}

/**
 * Place the ribbon around the observation rectangle without activating Desktop.
 * @param window - observation frame.
 * @param region - Computer Use observation bounds.
 */
export function showObservationFrame(window: BrowserWindow, region: OverlayRect): void {
  if (window.isDestroyed()) return
  window.setBounds(observationFrameBounds(region))
  window.setIgnoreMouseEvents(true, { forward: true })
  window.showInactive()
  window.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, OBSERVATION_FRAME_ALWAYS_ON_TOP_RELATIVE)
}

/**
 * Keep the floating overlay (and a visible selection toolbar) above the observation-frame ribbon.
 * `showInactive` on the ribbon can restack same-level panels; re-assert the higher relative level after each show.
 * @param overlay - floating ball / expanded transcript window.
 * @param toolbar - selection toolbar, if it exists.
 */
export function raiseOverlayAboveObservationFrame(
  overlay: BrowserWindow | undefined,
  toolbar?: BrowserWindow,
): void {
  if (overlay !== undefined && !overlay.isDestroyed()) {
    overlay.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, FLOATING_OVERLAY_ALWAYS_ON_TOP_RELATIVE)
    overlay.moveTop()
  }
  if (toolbar !== undefined && !toolbar.isDestroyed() && toolbar.isVisible()) {
    toolbar.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, FLOATING_OVERLAY_ALWAYS_ON_TOP_RELATIVE)
    toolbar.moveTop()
  }
}

/**
 * Hide the ribbon when it is still alive.
 * @param window - observation frame.
 */
export function hideObservationFrame(window: BrowserWindow | undefined): void {
  if (window === undefined || window.isDestroyed()) return
  window.hide()
}
