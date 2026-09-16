/** macOS selection-toolbar overlay window geometry and BrowserWindow construction. */

import { BrowserWindow, screen } from 'electron'
import type { SelectionBounds } from './selection-monitor.ts'

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
 * Place the toolbar below a selection rectangle, else at the mouse-up point, clamped to the work area.
 * @param anchor - mouse-up in Electron screen coordinates.
 * @param selectionBounds - AX selection rectangle when known.
 * @param size - toolbar size.
 * @param workArea - containing display work area.
 * @returns window bounds.
 */
export function selectionToolbarBounds(
  anchor: { readonly x: number; readonly y: number },
  selectionBounds: SelectionBounds | undefined,
  size: { readonly width: number; readonly height: number } = SELECTION_TOOLBAR_SIZE,
  workArea: OverlayRect = workAreaOf(anchor),
): OverlayRect {
  const gap = 8
  const origin = selectionBounds === undefined
    ? { x: anchor.x, y: anchor.y + gap }
    : { x: selectionBounds.x, y: selectionBounds.y + selectionBounds.height + gap }
  return {
    x: clamp(origin.x, workArea.x, workArea.x + workArea.width - size.width),
    y: clamp(origin.y, workArea.y, workArea.y + workArea.height - size.height),
    width: size.width,
    height: size.height,
  }
}

/**
 * Construct the selection-toolbar panel. The caller loads `dsh-app://shell/selection-toolbar.html`.
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
    type: 'panel',
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
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
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
