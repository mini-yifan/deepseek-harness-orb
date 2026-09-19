/** macOS Computer Use observation-frame overlay geometry and BrowserWindow construction. */

import { BrowserWindow, screen } from 'electron'

/** Stroke width painted on `#frame`; keep in sync with renderer CSS `#frame` padding fallback. */
export const OBSERVATION_FRAME_STROKE_PX = 4

/** Gutter around the stroke so `filter: drop-shadow` is not clipped by the window. Keep in sync with `body` padding fallback. */
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

/** Per-edge CSS padding in logical pixels (top, right, bottom, left). */
export interface ObservationFrameEdgePadding {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/**
 * Electron content rectangle plus the body glow and `#frame` stroke that keep the inner hole on the observation rectangle.
 */
export interface ObservationFramePlacement {
  readonly bounds: OverlayRect
  readonly glow: ObservationFrameEdgePadding
  readonly stroke: ObservationFrameEdgePadding
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

function intersectRects(area: OverlayRect, clip: OverlayRect): OverlayRect {
  const x = Math.max(area.x, clip.x)
  const y = Math.max(area.y, clip.y)
  const right = Math.min(area.x + area.width, clip.x + clip.width)
  const bottom = Math.min(area.y + area.height, clip.y + clip.height)
  const width = right - x
  const height = bottom - y
  if (width >= 1 && height >= 1) return { x, y, width, height }
  return {
    x: clamp(area.x, clip.x, clip.x + clip.width - 1),
    y: clamp(area.y, clip.y, clip.y + clip.height - 1),
    width: 1,
    height: 1,
  }
}

function edgePadding(inset: number): { readonly glow: number; readonly stroke: number } {
  const leftover = Math.max(0, Math.round(inset))
  return {
    glow: Math.max(0, leftover - OBSERVATION_FRAME_STROKE_PX),
    stroke: OBSERVATION_FRAME_STROKE_PX,
  }
}

/**
 * Body glow and `#frame` stroke padding so the inner hole stays on `region`.
 * A flush edge (no leftover outset) uses a 4px stroke just inside that edge.
 * @param region - Computer Use `ScreenInfo.bounds` in global logical points.
 * @param bounds - Electron content rectangle after work-area / WindowServer clip.
 * @returns per-edge glow (body) and stroke (`#frame`) padding in CSS pixels.
 */
export function observationFramePadding(
  region: OverlayRect,
  bounds: OverlayRect,
): { readonly glow: ObservationFrameEdgePadding; readonly stroke: ObservationFrameEdgePadding } {
  const left = edgePadding(region.x - bounds.x)
  const top = edgePadding(region.y - bounds.y)
  const right = edgePadding(bounds.x + bounds.width - (region.x + region.width))
  const bottom = edgePadding(bounds.y + bounds.height - (region.y + region.height))
  return {
    glow: { top: top.glow, right: right.glow, bottom: bottom.glow, left: left.glow },
    stroke: { top: top.stroke, right: right.stroke, bottom: bottom.stroke, left: left.stroke },
  }
}

/**
 * Inflate the observation union so the stroke and glow sit just outside it, then intersect the display work area.
 * Intersection clips an edge that would leave the work area; it does not translate the overlay and keep its size.
 * @param region - Computer Use `ScreenInfo.bounds` in global logical points.
 * @param workArea - containing display work area.
 * @returns Electron content bounds and per-edge CSS padding.
 */
export function observationFramePlacement(
  region: OverlayRect,
  workArea: OverlayRect = workAreaOf({
    x: region.x + region.width / 2,
    y: region.y + region.height / 2,
  }),
): ObservationFramePlacement {
  const inflated = {
    x: Math.round(region.x - OBSERVATION_FRAME_OUTSET),
    y: Math.round(region.y - OBSERVATION_FRAME_OUTSET),
    width: Math.max(1, Math.round(region.width + OBSERVATION_FRAME_OUTSET * 2)),
    height: Math.max(1, Math.round(region.height + OBSERVATION_FRAME_OUTSET * 2)),
  }
  const bounds = intersectRects(inflated, workArea)
  const padding = observationFramePadding(region, bounds)
  return { bounds, glow: padding.glow, stroke: padding.stroke }
}

function observationFrameCssScript(
  glow: ObservationFrameEdgePadding,
  stroke: ObservationFrameEdgePadding,
): string {
  const vars: ReadonlyArray<readonly [string, number]> = [
    ['--glow-top', glow.top],
    ['--glow-right', glow.right],
    ['--glow-bottom', glow.bottom],
    ['--glow-left', glow.left],
    ['--stroke-top', stroke.top],
    ['--stroke-right', stroke.right],
    ['--stroke-bottom', stroke.bottom],
    ['--stroke-left', stroke.left],
  ]
  const assignments = vars.map(([name, value]) =>
    `root.setProperty(${JSON.stringify(name)}, ${JSON.stringify(`${String(value)}px`)});`,
  ).join('')
  return `(() => { const root = document.documentElement.style; ${assignments} })()`
}

const pendingFrameCss = new WeakMap<BrowserWindow, {
  readonly glow: ObservationFrameEdgePadding
  readonly stroke: ObservationFrameEdgePadding
}>()

const waitingForFrameLoad = new WeakSet<BrowserWindow>()

function applyObservationFrameCss(
  window: BrowserWindow,
  glow: ObservationFrameEdgePadding,
  stroke: ObservationFrameEdgePadding,
): void {
  pendingFrameCss.set(window, { glow, stroke })
  const applyLatest = (): void => {
    waitingForFrameLoad.delete(window)
    if (window.isDestroyed()) return
    const latest = pendingFrameCss.get(window)
    if (latest === undefined) return
    void window.webContents.executeJavaScript(observationFrameCssScript(latest.glow, latest.stroke)).catch(() => {
      // executeJavaScript rejects when the document is not yet observation-frame.html; retry once after load.
      if (window.isDestroyed() || waitingForFrameLoad.has(window)) return
      waitingForFrameLoad.add(window)
      window.webContents.once('did-finish-load', applyLatest)
    })
  }
  if (window.webContents.isLoading()) {
    if (!waitingForFrameLoad.has(window)) {
      waitingForFrameLoad.add(window)
      window.webContents.once('did-finish-load', applyLatest)
    }
    return
  }
  applyLatest()
}

/**
 * Construct the hollow observation-frame panel. The caller loads `dsh-app://shell/observation-frame.html`.
 * Always click-through: Computer Use HID must hit the target app, not this chrome.
 * `roundedCorners: false` keeps a work-area-flush stroke from being round-clipped at the screen corners.
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
    roundedCorners: false,
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
 * Sets content bounds and shows the panel, then CSS padding from the actual content
 * rectangle so WindowServer clips cannot shift the inner hole.
 * @param window - observation frame.
 * @param region - Computer Use observation bounds.
 */
export function showObservationFrame(window: BrowserWindow, region: OverlayRect): void {
  if (window.isDestroyed()) return
  const placement = observationFramePlacement(region)
  window.setContentBounds(placement.bounds)
  window.setIgnoreMouseEvents(true, { forward: true })
  window.showInactive()
  window.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, OBSERVATION_FRAME_ALWAYS_ON_TOP_RELATIVE)
  const padding = observationFramePadding(region, window.getContentBounds())
  applyObservationFrameCss(window, padding.glow, padding.stroke)
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
