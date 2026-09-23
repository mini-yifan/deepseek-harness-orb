/** Selection-toolbar overlay window geometry and BrowserWindow construction. */

import { BrowserWindow, screen } from 'electron'
import { presentOverlayWindow } from './floating-window.ts'
import {
  FLOATING_OVERLAY_ALWAYS_ON_TOP_RELATIVE,
  OVERLAY_ALWAYS_ON_TOP_LEVEL,
} from './observation-frame-window.ts'

/** Default toolbar size before the renderer reports content width. */
export const SELECTION_TOOLBAR_SIZE = { width: 280, height: 46 } as const

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
 * Place the toolbar below the mouse-up point, clamped to the work area.
 * AX selection rectangles are not used: browsers often report window-local or chrome-origin rects.
 * @param anchor - mouse-up in Electron screen coordinates.
 * @param size - toolbar size.
 * @param workArea - containing display work area.
 * @returns window bounds.
 */
export function selectionToolbarBounds(
  anchor: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number } = SELECTION_TOOLBAR_SIZE,
  workArea: OverlayRect = workAreaOf(anchor),
): OverlayRect {
  const gap = 8
  return {
    x: clamp(anchor.x, workArea.x, workArea.x + workArea.width - size.width),
    y: clamp(anchor.y + gap, workArea.y, workArea.y + workArea.height - size.height),
    width: size.width,
    height: size.height,
  }
}

/**
 * Resize the toolbar around the compact bar origin so a language menu can paint.
 * Grows down when the work area has room; otherwise grows up so the bar bottom stays put.
 * @param barOrigin - compact toolbar top-left from {@link selectionToolbarBounds}.
 * @param contentSize - renderer-measured bar plus optional menu.
 * @param workArea - containing display work area.
 * @returns window bounds. `y < barOrigin.y` means the menu is above the bar.
 */
export function selectionToolbarMenuBounds(
  barOrigin: { readonly x: number; readonly y: number },
  contentSize: { readonly width: number; readonly height: number },
  workArea: OverlayRect = workAreaOf(barOrigin),
): OverlayRect {
  const width = Math.max(1, Math.round(contentSize.width))
  const height = Math.max(1, Math.round(contentSize.height))
  const x = clamp(barOrigin.x, workArea.x, workArea.x + workArea.width - width)
  const fitsBelow = barOrigin.y + height <= workArea.y + workArea.height
  if (fitsBelow || height <= SELECTION_TOOLBAR_SIZE.height) {
    return {
      x,
      y: clamp(barOrigin.y, workArea.y, workArea.y + workArea.height - height),
      width,
      height,
    }
  }
  return {
    x,
    y: clamp(
      barOrigin.y + SELECTION_TOOLBAR_SIZE.height - height,
      workArea.y,
      workArea.y + workArea.height - height,
    ),
    width,
    height,
  }
}

/**
 * Construct the selection-toolbar window. The caller loads `dsh-app://shell/selection-toolbar.html`.
 * @param preload - context-isolated shell preload.
 * @returns a hidden, non-activating overlay.
 */
export function createSelectionToolbarWindow(preload: string): BrowserWindow {
  const window = new BrowserWindow({
    width: SELECTION_TOOLBAR_SIZE.width,
    height: SELECTION_TOOLBAR_SIZE.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    ...process.platform === 'win32' ? {} : { type: 'panel' as const },
    show: false,
    hasShadow: true,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  presentOverlayWindow(window)
  if (process.platform === 'darwin') {
    window.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, FLOATING_OVERLAY_ALWAYS_ON_TOP_RELATIVE)
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}

/**
 * Show the toolbar without activating the Desktop app.
 * @param window - selection toolbar.
 * @param bounds - screen rectangle.
 */
export function showSelectionToolbar(window: BrowserWindow, bounds: OverlayRect): void {
  if (window.isDestroyed()) return
  window.setBounds(bounds)
  window.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, FLOATING_OVERLAY_ALWAYS_ON_TOP_RELATIVE)
  window.showInactive()
}

/**
 * Hide the toolbar when it is still alive.
 * @param window - selection toolbar.
 */
export function hideSelectionToolbar(window: BrowserWindow | undefined): void {
  if (window === undefined || window.isDestroyed()) return
  window.hide()
}

/**
 * Whether a screen point lands inside a live window.
 * @param window - overlay to hit-test.
 * @param point - Electron screen coordinates.
 */
export function pointInWindow(
  window: BrowserWindow | undefined,
  point: { readonly x: number; readonly y: number },
): boolean {
  if (window === undefined || window.isDestroyed() || !window.isVisible()) return false
  const bounds = window.getBounds()
  return point.x >= bounds.x && point.y >= bounds.y
    && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height
}
