/** macOS floating-ball window geometry and BrowserWindow construction. */

import { BrowserWindow, Menu, type MenuItemConstructorOptions, screen } from 'electron'
import type { DesktopMessages } from './locale.ts'
import {
  floatingAgentModelItems,
  type FloatingModelCatalog,
} from './floating-agent-menu.ts'
import type { OrbAgentModelSelection } from './orb-agent-models.ts'

/** Electron `context-menu` fields that choose overlay right-click items. */
export interface FloatingContextEditState {
  readonly isEditable: boolean
  readonly editFlags: {
    readonly canCut: boolean
    readonly canCopy: boolean
    readonly canPaste: boolean
  }
}

/** Live overlay and background model menus rebuilt on every right-click. */
export interface FloatingAgentMenuState {
  readonly catalog: FloatingModelCatalog | undefined
  readonly overlay: OrbAgentModelSelection
  readonly background: OrbAgentModelSelection
  readonly onSelectOverlay: (selection: OrbAgentModelSelection) => void
  readonly onSelectBackground: (selection: OrbAgentModelSelection) => void
}

/** Catalog load and stored selections for the overlay context menu. */
export interface FloatingAgentMenuSource {
  readonly loadCatalog: () => Promise<FloatingModelCatalog | undefined>
  readonly overlay: () => OrbAgentModelSelection
  readonly background: () => OrbAgentModelSelection
  readonly onSelectOverlay: (selection: OrbAgentModelSelection) => void
  readonly onSelectBackground: (selection: OrbAgentModelSelection) => void
}

/**
 * Overlay right-click items: cut/copy/paste when the target is editable, then Open Main,
 * Agent model menus, selection toolbar, and Quit.
 * @param params - Electron context-menu editability.
 * @param messages - locale dictionary for the overlay actions.
 * @param onOpenMain - show the Desktop main window.
 * @param onQuit - quit the application.
 * @param selection - optional selection-toolbar toggle.
 * @param agents - optional catalog-driven overlay and background model menus.
 * @returns Electron menu template.
 */
export function floatingContextMenuTemplate(
  params: FloatingContextEditState,
  messages: Pick<
    DesktopMessages,
    | 'floatingOpenMain'
    | 'floatingAgentSettings'
    | 'floatingBackgroundAgentSettings'
    | 'floatingNoModels'
    | 'floatingEffortDefault'
    | 'floatingQuit'
    | 'selectionToolbarEnable'
    | 'selectionToolbarDisable'
  >,
  onOpenMain: () => void,
  onQuit: () => void,
  selection?: { readonly enabled: boolean; readonly onToggle: () => void },
  agents?: FloatingAgentMenuState,
): MenuItemConstructorOptions[] {
  const labels = { empty: messages.floatingNoModels, defaultEffort: messages.floatingEffortDefault }
  const actions: MenuItemConstructorOptions[] = [
    { label: messages.floatingOpenMain, click: onOpenMain },
    { type: 'separator' },
    ...(agents === undefined ? [] : [
      {
        label: messages.floatingAgentSettings,
        submenu: floatingAgentModelItems(
          agents.catalog,
          agents.overlay,
          agents.onSelectOverlay,
          labels,
        ),
      },
      {
        label: messages.floatingBackgroundAgentSettings,
        submenu: floatingAgentModelItems(
          agents.catalog,
          agents.background,
          agents.onSelectBackground,
          labels,
        ),
      },
      { type: 'separator' as const },
    ]),
    { label: messages.floatingQuit, click: onQuit },
  ]
  if (selection !== undefined) {
    const quitIndex = actions.findIndex(item => item.label === messages.floatingQuit)
    actions.splice(quitIndex, 0, {
      label: selection.enabled ? messages.selectionToolbarDisable : messages.selectionToolbarEnable,
      click: selection.onToggle,
    }, { type: 'separator' })
  }
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

/**
 * Transparent padding around the visual ball and panel so CSS drop shadows and
 * outer pin strokes are not clipped by the overlay window.
 */
export const FLOATING_CHROME_INSET = 12

/** Collapsed overlay window size including {@link FLOATING_CHROME_INSET}. */
export const FLOATING_BALL_WINDOW_SIZE = FLOATING_BALL_SIZE + 2 * FLOATING_CHROME_INSET

/** Downward offset from work-area vertical center, as a fraction of work-area height. */
export const FLOATING_BALL_DEFAULT_BELOW_CENTER = 0.08

/** Expanded overlay window size including {@link FLOATING_CHROME_INSET}. */
export const FLOATING_PANEL_WINDOW_SIZE = {
  width: FLOATING_PANEL_SIZE.width + 2 * FLOATING_CHROME_INSET,
  height: FLOATING_PANEL_SIZE.height + 2 * FLOATING_CHROME_INSET,
} as const

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

function isCollapsedOverlay(bounds: OverlayRect): boolean {
  return bounds.width <= FLOATING_BALL_WINDOW_SIZE && bounds.height <= FLOATING_BALL_WINDOW_SIZE
}

function collapsedWindowBounds(ball: { readonly x: number; readonly y: number }): OverlayRect {
  return {
    x: ball.x - FLOATING_CHROME_INSET,
    y: ball.y - FLOATING_CHROME_INSET,
    width: FLOATING_BALL_WINDOW_SIZE,
    height: FLOATING_BALL_WINDOW_SIZE,
  }
}

function clampWindowOrigin(value: number, workOrigin: number, workSize: number, windowSize: number): number {
  return clamp(
    value,
    workOrigin - FLOATING_CHROME_INSET,
    workOrigin + workSize - windowSize + FLOATING_CHROME_INSET,
  )
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
    x: direction.horizontal === 'left'
      ? bounds.x + bounds.width - FLOATING_CHROME_INSET - FLOATING_BALL_SIZE
      : bounds.x + FLOATING_CHROME_INSET,
    y: direction.vertical === 'up'
      ? bounds.y + bounds.height - FLOATING_CHROME_INSET - FLOATING_BALL_SIZE
      : bounds.y + FLOATING_CHROME_INSET,
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
 * Collapsed-ball origin on a work-area right edge, slightly below vertical center.
 * @param workArea - display work area that should contain the ball.
 * @returns origin that keeps the 72px ball fully visible.
 */
export function defaultFloatingBallOrigin(workArea: OverlayRect): { x: number; y: number } {
  const x = workArea.x + workArea.width - FLOATING_BALL_SIZE
  const centerY = workArea.y + (workArea.height - FLOATING_BALL_SIZE) / 2
  const y = centerY + workArea.height * FLOATING_BALL_DEFAULT_BELOW_CENTER
  return clampedBallOrigin({ x: Math.round(x), y: Math.round(y) }, workArea)
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
    x: clampWindowOrigin(unclamped.x, workArea.x, workArea.width, unclamped.width),
    y: clampWindowOrigin(unclamped.y, workArea.y, workArea.height, unclamped.height),
    width: unclamped.width,
    height: unclamped.height,
    ...direction,
  }
}

function overlayBoundsFromBall(
  ball: { readonly x: number; readonly y: number },
  direction: { readonly horizontal: FloatingHorizontalExpand; readonly vertical: FloatingVerticalExpand },
): OverlayRect {
  const width = FLOATING_PANEL_WINDOW_SIZE.width
  const height = FLOATING_PANEL_WINDOW_SIZE.height
  return {
    x: direction.horizontal === 'left'
      ? ball.x - (FLOATING_PANEL_SIZE.width - FLOATING_BALL_SIZE) - FLOATING_CHROME_INSET
      : ball.x - FLOATING_CHROME_INSET,
    y: direction.vertical === 'up'
      ? ball.y - (FLOATING_PANEL_SIZE.height - FLOATING_BALL_SIZE) - FLOATING_CHROME_INSET
      : ball.y - FLOATING_CHROME_INSET,
    width,
    height,
  }
}

function currentBallOrigin(window: BrowserWindow, workArea: OverlayRect): { x: number; y: number } {
  const bounds = window.getBounds()
  if (isCollapsedOverlay(bounds)) {
    return { x: bounds.x + FLOATING_CHROME_INSET, y: bounds.y + FLOATING_CHROME_INSET }
  }
  const stored = overlayDirection.get(window) ?? expandDirection({ x: bounds.x, y: bounds.y }, workArea)
  return ballOriginFromWindow(bounds, stored)
}

/**
 * Construct the macOS overlay BrowserWindow. The caller loads `dsh-app://shell/floating.html`.
 * Places the collapsed overlay on the primary-display work-area right edge, slightly below vertical center.
 * @param preload - context-isolated shell preload.
 * @param messages - locale dictionary for the right-click menu.
 * @param onOpenMain - show the Desktop main window.
 * @param onQuit - quit the application.
 * @param selection - optional selection-toolbar toggle on the overlay menu.
 * @param agents - optional catalog-driven overlay and background model menus.
 * @returns the overlay window.
 */
export function createFloatingWindow(
  preload: string,
  messages: DesktopMessages,
  onOpenMain: () => void,
  onQuit: () => void,
  selection?: { readonly enabled: () => boolean; readonly toggle: () => void },
  agents?: FloatingAgentMenuSource,
): BrowserWindow {
  const bounds = collapsedWindowBounds(defaultFloatingBallOrigin(screen.getPrimaryDisplay().workArea))
  const window = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
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
    void popupFloatingContextMenu(window, params, messages, onOpenMain, onQuit, selection, agents)
  })
  return window
}

async function popupFloatingContextMenu(
  window: BrowserWindow,
  params: FloatingContextEditState,
  messages: DesktopMessages,
  onOpenMain: () => void,
  onQuit: () => void,
  selection: { readonly enabled: () => boolean; readonly toggle: () => void } | undefined,
  agents: FloatingAgentMenuSource | undefined,
): Promise<void> {
  const catalog = agents === undefined ? undefined : await agents.loadCatalog().catch(() => undefined)
  if (window.isDestroyed()) return
  Menu.buildFromTemplate(floatingContextMenuTemplate(
    params,
    messages,
    onOpenMain,
    onQuit,
    selection === undefined ? undefined : { enabled: selection.enabled(), onToggle: selection.toggle },
    agents === undefined ? undefined : {
      catalog,
      overlay: agents.overlay(),
      background: agents.background(),
      onSelectOverlay: agents.onSelectOverlay,
      onSelectBackground: agents.onSelectBackground,
    },
  )).popup({ window })
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
  window.setBounds(collapsedWindowBounds(origin))
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
  if (isCollapsedOverlay(bounds)) {
    window.setBounds(collapsedWindowBounds(origin))
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
  if (isCollapsedOverlay(bounds)) {
    const origin = clampedBallOrigin({
      x: bounds.x + FLOATING_CHROME_INSET,
      y: bounds.y + FLOATING_CHROME_INSET,
    }, workArea)
    window.setBounds(collapsedWindowBounds(origin))
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
const overlayClickThrough = new WeakMap<BrowserWindow, boolean>()

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
 * Pass every Desktop overlay that must stay out of the shot.
 * Hidden windows are omitted: ScreenCaptureKit `onScreenWindowsOnly` cannot see them,
 * and a missing exclude id fails capture.
 * @param windows - floating ball, selection toolbar, or other capture-excluded chrome.
 * @returns CGWindowIDs, omitting destroyed or hidden windows.
 */
export function overlayWindowExcludeIds(...windows: Array<BrowserWindow | undefined>): number[] {
  const ids: number[] = []
  for (const window of windows) {
    if (window === undefined || window.isDestroyed() || !window.isVisible()) continue
    ids.push(cgWindowIdFromMediaSourceId(window.getMediaSourceId()))
  }
  return ids
}

/** Milliseconds Electron waits after click-through before acking input begin, so WindowServer hit-testing has committed. */
export const OVERLAY_GUARD_INPUT_APPLY_MS = 80

function syncOverlayGuard(window: BrowserWindow, counts: OverlayGuardCounts): void {
  if (window.isDestroyed()) return
  const clickThrough = counts.input > 0
  if (overlayClickThrough.get(window) === clickThrough) return
  overlayClickThrough.set(window, clickThrough)
  if (clickThrough) {
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
 * Overlapping begins are refcounted. Click-through and blur apply only when the
 * input count crosses zero, so nested capture IPC during a HID turn does not flash the overlay.
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
  overlayClickThrough.delete(window)
  if (window.isDestroyed()) return
  window.setIgnoreMouseEvents(false)
}
