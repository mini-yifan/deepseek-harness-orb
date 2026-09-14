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
export const FLOATING_PANEL_SIZE = { width: 320, height: 420 } as const

/** Horizontal growth relative to the ball origin. */
export type FloatingHorizontalExpand = 'left' | 'right'

/** Vertical growth relative to the ball origin. */
export type FloatingVerticalExpand = 'up' | 'down'

/** Overlay size and growth after `setFloatingExpanded`. */
export interface FloatingExpandState {
  readonly expanded: boolean
  readonly horizontal: FloatingHorizontalExpand
  readonly vertical: FloatingVerticalExpand
}

interface OverlayRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const overlayDirection = new WeakMap<BrowserWindow, {
  horizontal: FloatingHorizontalExpand
  vertical: FloatingVerticalExpand
}>()

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
 * Choose panel growth so the expanded overlay stays on the same side of the ball as free work-area space.
 * @param ball - current ball origin.
 * @param workArea - display work area containing the ball.
 * @returns horizontal and vertical growth.
 */
export function expandDirection(
  ball: { readonly x: number; readonly y: number },
  workArea: OverlayRect,
): { horizontal: FloatingHorizontalExpand; vertical: FloatingVerticalExpand } {
  const cx = ball.x + FLOATING_BALL_SIZE / 2
  const horizontal: FloatingHorizontalExpand = cx - workArea.x > workArea.width / 2 ? 'left' : 'right'
  const vertical: FloatingVerticalExpand = ball.y - workArea.y < FLOATING_PANEL_SIZE.height - FLOATING_BALL_SIZE
    ? 'down'
    : 'up'
  return { horizontal, vertical }
}

/**
 * Ball origin inside an expanded overlay for a stored growth direction.
 * @param bounds - expanded overlay bounds.
 * @param direction - growth used when expanding.
 * @returns ball top-left.
 */
export function ballOriginFromWindow(
  bounds: OverlayRect,
  direction: { readonly horizontal: FloatingHorizontalExpand; readonly vertical: FloatingVerticalExpand },
): { x: number; y: number } {
  return {
    x: direction.horizontal === 'left' ? bounds.x + bounds.width - FLOATING_BALL_SIZE : bounds.x,
    y: direction.vertical === 'up' ? bounds.y + bounds.height - FLOATING_BALL_SIZE : bounds.y,
  }
}

/**
 * Clamp a 72px ball origin inside a work area.
 * @param ball - requested origin.
 * @param workArea - display work area.
 * @returns origin that keeps the ball fully visible.
 */
export function clampedBallOrigin(
  ball: { readonly x: number; readonly y: number },
  workArea: OverlayRect,
): { x: number; y: number } {
  return {
    x: clamp(ball.x, workArea.x, workArea.x + workArea.width - FLOATING_BALL_SIZE),
    y: clamp(ball.y, workArea.y, workArea.y + workArea.height - FLOATING_BALL_SIZE),
  }
}

/**
 * Expanded overlay rectangle that keeps the ball origin in its growth corner.
 * @param ball - ball top-left before expand.
 * @param workArea - display work area.
 * @returns bounds plus the growth used.
 */
export function expandedOverlayBounds(
  ball: { readonly x: number; readonly y: number },
  workArea: OverlayRect,
): OverlayRect & { horizontal: FloatingHorizontalExpand; vertical: FloatingVerticalExpand } {
  const direction = expandDirection(ball, workArea)
  const unclamped = overlayBoundsFromBall(ball, direction)
  return {
    x: clamp(unclamped.x, workArea.x, workArea.x + workArea.width - unclamped.width),
    y: clamp(unclamped.y, workArea.y, workArea.y + workArea.height - unclamped.height),
    width: unclamped.width,
    height: unclamped.height,
    ...direction,
  }
}

function overlayBoundsFromBall(
  ball: { readonly x: number; readonly y: number },
  direction: { readonly horizontal: FloatingHorizontalExpand; readonly vertical: FloatingVerticalExpand },
): OverlayRect {
  const width = FLOATING_PANEL_SIZE.width
  const height = FLOATING_PANEL_SIZE.height
  return {
    x: direction.horizontal === 'left' ? ball.x - (width - FLOATING_BALL_SIZE) : ball.x,
    y: direction.vertical === 'up' ? ball.y - (height - FLOATING_BALL_SIZE) : ball.y,
    width,
    height,
  }
}

function currentBallOrigin(window: BrowserWindow, workArea: OverlayRect): { x: number; y: number } {
  const bounds = window.getBounds()
  if (bounds.width <= FLOATING_BALL_SIZE) return { x: bounds.x, y: bounds.y }
  const stored = overlayDirection.get(window) ?? expandDirection({ x: bounds.x, y: bounds.y }, workArea)
  return ballOriginFromWindow(bounds, stored)
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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('context-menu', (_event, params) => {
    Menu.buildFromTemplate(floatingContextMenuTemplate(params, messages, onOpenMain, onQuit)).popup({ window })
  })
  return window
}

/**
 * Resize the overlay between ball and panel while keeping the ball origin fixed.
 * @param window - floating overlay.
 * @param expanded - whether the transcript panel is visible.
 * @returns growth used for renderer layout.
 */
export function setFloatingExpanded(window: BrowserWindow, expanded: boolean): FloatingExpandState {
  const bounds = window.getBounds()
  const workArea = workAreaOf({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  })
  if (expanded) {
    const next = expandedOverlayBounds(currentBallOrigin(window, workArea), workArea)
    overlayDirection.set(window, { horizontal: next.horizontal, vertical: next.vertical })
    window.setBounds({ x: next.x, y: next.y, width: next.width, height: next.height })
    return { expanded: true, horizontal: next.horizontal, vertical: next.vertical }
  }
  const direction = overlayDirection.get(window) ?? expandDirection({ x: bounds.x, y: bounds.y }, workArea)
  const origin = clampedBallOrigin(currentBallOrigin(window, workArea), workArea)
  window.setBounds({ x: origin.x, y: origin.y, width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE })
  return { expanded: false, ...direction }
}

/**
 * Move the overlay so the 72px ball origin follows `(x, y)`.
 * An expanded overlay keeps its stored growth and does not clamp the panel.
 * @param window - floating overlay.
 * @param x - ball top-left x in screen coordinates.
 * @param y - ball top-left y in screen coordinates.
 */
export function moveFloatingBall(window: BrowserWindow, x: number, y: number): void {
  const origin = { x: Math.round(x), y: Math.round(y) }
  const bounds = window.getBounds()
  if (bounds.width <= FLOATING_BALL_SIZE && bounds.height <= FLOATING_BALL_SIZE) {
    window.setPosition(origin.x, origin.y)
    return
  }
  const stored = overlayDirection.get(window)
  const direction = stored ?? expandDirection(origin, workAreaOf(origin))
  window.setBounds(overlayBoundsFromBall(origin, direction))
}

/**
 * Keep the overlay inside the nearest work area without snapping to an edge.
 * @param window - floating overlay.
 */
export function clampFloatingWindow(window: BrowserWindow): void {
  const bounds = window.getBounds()
  const workArea = workAreaOf({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  })
  if (bounds.width <= FLOATING_BALL_SIZE) {
    const origin = clampedBallOrigin(bounds, workArea)
    window.setPosition(origin.x, origin.y)
    return
  }
  setFloatingExpanded(window, true)
}

/** Overlay chrome mode for one Computer Use capture or HID burst. */
export type FloatingOverlayGuardMode = 'capture' | 'input'

/** Begin or end one overlay-guard interval. */
export type FloatingOverlayGuardAction = 'begin' | 'end'

interface OverlayGuardCounts {
  capture: number
  input: number
}

const overlayGuardCounts = new WeakMap<BrowserWindow, OverlayGuardCounts>()

function countsOf(window: BrowserWindow): OverlayGuardCounts {
  const existing = overlayGuardCounts.get(window)
  if (existing !== undefined) return existing
  const created: OverlayGuardCounts = { capture: 0, input: 0 }
  overlayGuardCounts.set(window, created)
  return created
}

/**
 * Parse the overlay's `desktopCapturer` source id into a CGWindowID.
 * @param sourceId - `BrowserWindow.getMediaSourceId()` value (`window:<id>:…`).
 * @returns the CGWindowID ScreenCaptureKit excludes.
 * @throws when the id is not a positive window source.
 */
export function cgWindowIdFromMediaSourceId(sourceId: string): number {
  const match = /^window:(\d+)(?::|$)/u.exec(sourceId)
  if (match === null) {
    throw new Error(`dsh desktop: overlay media source id is not a CGWindowID: ${sourceId}`)
  }
  const id = Number(match[1])
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error(`dsh desktop: overlay media source id is not a CGWindowID: ${sourceId}`)
  }
  return id
}

/**
 * Overlay window ids Computer Use must omit from the next ScreenCaptureKit capture.
 * Ball and expanded panel share this BrowserWindow, so one id covers both.
 * @param window - floating overlay.
 * @returns a one-element id list, or `[]` when the window is gone.
 */
export function overlayWindowExcludeIds(window: BrowserWindow): number[] {
  if (window.isDestroyed()) return []
  return [cgWindowIdFromMediaSourceId(window.getMediaSourceId())]
}

/** Milliseconds Electron waits after click-through before acking input begin, so WindowServer hit-testing has committed. */
export const OVERLAY_GUARD_INPUT_APPLY_MS = 80

function syncOverlayGuard(window: BrowserWindow, counts: OverlayGuardCounts): void {
  if (window.isDestroyed()) return
  if (counts.input > 0) {
    window.setIgnoreMouseEvents(true, { forward: false })
    window.blur()
    return
  }
  window.setIgnoreMouseEvents(false)
}

/**
 * Apply or restore overlay click-through for one Computer Use HID interval.
 * Capture begin still refcounts so overlapping sessions stay paired with their ends;
 * ScreenCaptureKit exclusion uses {@link overlayWindowExcludeIds} rather than `contentProtection`.
 * HID click-through does not forward mouse events into the overlay renderer.
 * Overlapping begins are refcounted.
 * @param window - floating overlay.
 * @param mode - capture exclusion or HID click-through.
 * @param action - increment or decrement that mode's count.
 */
export function applyFloatingOverlayGuard(
  window: BrowserWindow,
  mode: FloatingOverlayGuardMode,
  action: FloatingOverlayGuardAction,
): void {
  if (window.isDestroyed()) return
  const counts = countsOf(window)
  if (action === 'begin') counts[mode] += 1
  else counts[mode] = Math.max(0, counts[mode] - 1)
  syncOverlayGuard(window, counts)
}

/**
 * Drop every overlay-guard interval and restore hittable chrome.
 * Host exit uses this so a lost `end` cannot leave the ball click-through.
 * @param window - floating overlay.
 */
export function resetFloatingOverlayGuard(window: BrowserWindow): void {
  overlayGuardCounts.delete(window)
  if (window.isDestroyed()) return
  syncOverlayGuard(window, { capture: 0, input: 0 })
}
