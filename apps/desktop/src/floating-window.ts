/** macOS floating-ball window geometry and BrowserWindow construction. */

import { BrowserWindow, Menu, type MenuItemConstructorOptions, screen } from 'electron'
import type { DesktopMessages } from './locale.ts'

/** Electron `context-menu` fields that choose overlay right-click items. */
export interface FloatingContextEditState {
  readonly isEditable: boolean
  readonly editFlags: {
    readonly canCut: boolean
    readonly canCopy: boolean
    readonly canPaste: boolean
  }
}

/**
 * Overlay right-click items: cut/copy/paste when the target is editable, then Open Main and Quit.
 * @param params - Electron context-menu editability.
 * @param messages - locale dictionary for the overlay actions.
 * @param onOpenMain - show the Desktop main window.
 * @param onQuit - quit the application.
 * @returns Electron menu template.
 */
export function floatingContextMenuTemplate(
  params: FloatingContextEditState,
  messages: Pick<DesktopMessages, 'floatingOpenMain' | 'floatingQuit'>,
  onOpenMain: () => void,
  onQuit: () => void,
): MenuItemConstructorOptions[] {
  const actions: MenuItemConstructorOptions[] = [
    { label: messages.floatingOpenMain, click: onOpenMain },
    { type: 'separator' },
    { label: messages.floatingQuit, click: onQuit },
  ]
  if (!params.isEditable) return actions
  return [
    { role: 'cut', enabled: params.editFlags.canCut },
    { role: 'copy', enabled: params.editFlags.canCopy },
    { role: 'paste', enabled: params.editFlags.canPaste },
    { type: 'separator' },
    ...actions,
  ]
}

/** Collapsed circular overlay size. */
export const FLOATING_BALL_SIZE = 72

/** Expanded overlay panel size. */
export const FLOATING_PANEL_SIZE = { width: 360, height: 520 } as const

/**
 * Snap a floating window origin to the nearest work-area edge.
 * @param bounds - current window bounds.
 * @param workArea - display work area containing the window center.
 * @returns origin that keeps the window inside the work area against one edge.
 */
export function dockedOrigin(
  bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  workArea: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): { x: number; y: number } {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const distLeft = Math.abs(cx - workArea.x)
  const distRight = Math.abs(workArea.x + workArea.width - cx)
  const distTop = Math.abs(cy - workArea.y)
  const distBottom = Math.abs(workArea.y + workArea.height - cy)
  const min = Math.min(distLeft, distRight, distTop, distBottom)
  const maxX = workArea.x + workArea.width - bounds.width
  const maxY = workArea.y + workArea.height - bounds.height
  const clampX = (x: number): number => Math.min(Math.max(x, workArea.x), Math.max(workArea.x, maxX))
  const clampY = (y: number): number => Math.min(Math.max(y, workArea.y), Math.max(workArea.y, maxY))
  if (min === distLeft) return { x: workArea.x, y: clampY(bounds.y) }
  if (min === distRight) return { x: maxX, y: clampY(bounds.y) }
  if (min === distTop) return { x: clampX(bounds.x), y: workArea.y }
  return { x: clampX(bounds.x), y: maxY }
}

/**
 * Construct the macOS overlay BrowserWindow. The caller loads `dsh-app://shell/floating.html`.
 * @param preload - context-isolated shell preload.
 * @param messages - locale dictionary for the right-click menu.
 * @param onOpenMain - show the Desktop main window.
 * @param onQuit - quit the application.
 * @returns the overlay window.
 */
export function createFloatingWindow(
  preload: string,
  messages: DesktopMessages,
  onOpenMain: () => void,
  onQuit: () => void,
): BrowserWindow {
  const window = new BrowserWindow({
    width: FLOATING_BALL_SIZE,
    height: FLOATING_BALL_SIZE,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    type: 'panel',
    show: true,
    hasShadow: false,
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
  window.setContentProtection(true)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('context-menu', (_event, params) => {
    Menu.buildFromTemplate(floatingContextMenuTemplate(params, messages, onOpenMain, onQuit)).popup({ window })
  })
  return window
}

/**
 * Resize the overlay between ball and panel, then dock to the nearest edge.
 * @param window - floating overlay.
 * @param expanded - whether the transcript panel is visible.
 */
export function setFloatingExpanded(window: BrowserWindow, expanded: boolean): void {
  const size = expanded ? FLOATING_PANEL_SIZE : { width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE }
  window.setSize(size.width, size.height)
  dockFloatingWindow(window)
}

/**
 * Move the overlay to the nearest display-edge dock position.
 * @param window - floating overlay.
 */
export function dockFloatingWindow(window: BrowserWindow): void {
  const bounds = window.getBounds()
  const display = screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  })
  const origin = dockedOrigin(bounds, display.workArea)
  window.setPosition(origin.x, origin.y)
}
