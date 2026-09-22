/** macOS floating-ball window geometry and BrowserWindow construction. */

import { BrowserWindow, Menu, type MenuItemConstructorOptions, screen, systemPreferences } from 'electron'
import type { DesktopMessages } from './locale.ts'
import {
  floatingAgentModelItems,
  type FloatingModelCatalog,
} from './floating-agent-menu.ts'
import type { OrbAgentModelSelection } from './orb-agent-models.ts'
import {
  FLOATING_OVERLAY_ALWAYS_ON_TOP_RELATIVE,
  OVERLAY_ALWAYS_ON_TOP_LEVEL,
} from './observation-frame-window.ts'

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
 * Agent model menus, selection toolbar, millifraction coordinates, and Quit.
 * @param params - Electron context-menu editability.
 * @param messages - locale dictionary for the overlay actions.
 * @param onOpenMain - show the Desktop main window.
 * @param onQuit - quit the application.
 * @param selection - optional selection-toolbar toggle.
 * @param agents - optional catalog-driven overlay and background model menus.
 * @param millifraction - optional millifraction-coordinates default toggle.
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
    | 'millifractionEnable'
    | 'millifractionDisable'
  >,
  onOpenMain: () => void,
  onQuit: () => void,
  selection?: { readonly enabled: boolean; readonly onToggle: () => void },
  agents?: FloatingAgentMenuState,
  millifraction?: { readonly enabled: boolean; readonly onToggle: () => void },
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
  if (selection !== undefined || millifraction !== undefined) {
    const extras: MenuItemConstructorOptions[] = []
    if (selection !== undefined) {
      extras.push({
        label: selection.enabled ? messages.selectionToolbarDisable : messages.selectionToolbarEnable,
        click: selection.onToggle,
      })
    }
    if (millifraction !== undefined) {
      extras.push({
        label: millifraction.enabled ? messages.millifractionDisable : messages.millifractionEnable,
        click: millifraction.onToggle,
      })
    }
    extras.push({ type: 'separator' })
    const quitIndex = actions.findIndex(item => item.label === messages.floatingQuit)
    actions.splice(quitIndex, 0, ...extras)
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

/** Left or right display edge that currently holds a docked overlay. */
export type FloatingDockSide = 'left' | 'right'

/** Docked tab after `clampFloatingWindow`, or undocked after `unsnapDockedBall`. */
export interface FloatingDockState {
  readonly docked: FloatingDockSide | undefined
}

/** Overlay size and growth after `setFloatingExpanded`. */
export interface FloatingExpandState extends FloatingDockState {
  readonly expanded: boolean
  readonly horizontal: FloatingHorizontalExpand
  readonly vertical: FloatingVerticalExpand
}

/** Ball width that must sit past a left or right display edge before pointer-up docks. */
export const FLOATING_DOCK_OVERLAP = Math.round(FLOATING_BALL_SIZE / 5)

/** Cursor distance from a docked edge that pulls the tab back into a 72px ball. */
export const FLOATING_DOCK_DRAG_OFF = Math.round(FLOATING_BALL_SIZE / 3)

/** Painted dock-tab width in CSS pixels. */
export const FLOATING_DOCK_TAB_WIDTH = 6

/** Painted dock-tab height in CSS pixels; matches {@link FLOATING_BALL_SIZE}. */
export const FLOATING_DOCK_TAB_HEIGHT = FLOATING_BALL_SIZE

/** Inner glow padding around the painted tab. */
export const FLOATING_DOCK_GLOW = 8

/** Extra inward hit strip beyond the painted tab. */
export const FLOATING_DOCK_HOVER_MARGIN = 20

/** Overlay window width while docked: tab + inner glow + hover strip. */
export const FLOATING_DOCK_HIT_WIDTH =
  FLOATING_DOCK_TAB_WIDTH + FLOATING_DOCK_GLOW + FLOATING_DOCK_HOVER_MARGIN

/** Overlay window height while docked: tab plus glow above and below. */
export const FLOATING_DOCK_HIT_HEIGHT = FLOATING_DOCK_TAB_HEIGHT + 2 * FLOATING_DOCK_GLOW

/** Gap past the display edge when the ball slides fully off before the tab appears. */
export const FLOATING_DOCK_OFF_GAP = 2

/** Inset from the display edge after unsnap. */
export const FLOATING_DOCK_IN_PAD = 5

/** Slide-off duration before the tab appears. */
export const FLOATING_DOCK_SLIDE_OFF_MS = 250

/** Slide-in duration after unsnap. */
export const FLOATING_DOCK_SLIDE_IN_MS = 300

/** Painted dock-tab fill; matches CoView `PALETTE["scrollbar"]`. */
export const FLOATING_DOCK_TAB_FILL = '#75757F'

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

const overlayDock = new WeakMap<BrowserWindow, { side: FloatingDockSide; y: number }>()

interface OverlayAnim {
  cancelled: boolean
  resolve: () => void
}

const overlayAnim = new WeakMap<BrowserWindow, OverlayAnim>()

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

function displayGeometry(point: { readonly x: number; readonly y: number }): {
  readonly bounds: OverlayRect
  readonly workArea: OverlayRect
} {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(point.x),
    y: Math.round(point.y),
  })
  return { bounds: display.bounds, workArea: display.workArea }
}

function workAreaOf(point: { readonly x: number; readonly y: number }): OverlayRect {
  return displayGeometry(point).workArea
}

function expandState(
  expanded: boolean,
  direction: { readonly horizontal: FloatingHorizontalExpand; readonly vertical: FloatingVerticalExpand },
  docked: FloatingDockSide | undefined,
): FloatingExpandState {
  return { expanded, horizontal: direction.horizontal, vertical: direction.vertical, docked }
}

/**
 * Which left/right display edge the ball already overlaps by {@link FLOATING_DOCK_OVERLAP}.
 * Top and bottom never dock. Dock itself is committed on pointer-up, not during the drag.
 * @param ball - 72px ball top-left.
 * @param bounds - containing display `bounds` (screen edge, not work area).
 * @returns the dock side, or `undefined` when fewer than about one-fifth of the ball is past that edge.
 */
export function dockSideForBallOrigin(
  ball: { readonly x: number; readonly y: number },
  bounds: OverlayRect,
): FloatingDockSide | undefined {
  const leftOverlap = bounds.x - ball.x
  const rightOverlap = ball.x + FLOATING_BALL_SIZE - (bounds.x + bounds.width)
  if (leftOverlap >= FLOATING_DOCK_OVERLAP && leftOverlap >= rightOverlap) return 'left'
  if (rightOverlap >= FLOATING_DOCK_OVERLAP) return 'right'
  return undefined
}

/**
 * Overlay rectangle for the docked tab flush with a display edge.
 * @param side - left or right display edge.
 * @param ballY - 72px ball top used to center the tab vertically.
 * @param bounds - containing display `bounds`.
 * @returns a hittable strip {@link FLOATING_DOCK_HIT_WIDTH} by {@link FLOATING_DOCK_HIT_HEIGHT}.
 */
export function dockedTabBounds(
  side: FloatingDockSide,
  ballY: number,
  bounds: OverlayRect,
): OverlayRect {
  const y = clamp(
    Math.round(ballY - FLOATING_DOCK_GLOW),
    bounds.y,
    bounds.y + bounds.height - FLOATING_DOCK_HIT_HEIGHT,
  )
  return {
    x: side === 'left' ? bounds.x : bounds.x + bounds.width - FLOATING_DOCK_HIT_WIDTH,
    y,
    width: FLOATING_DOCK_HIT_WIDTH,
    height: FLOATING_DOCK_HIT_HEIGHT,
  }
}

function clampBallY(ballY: number, bounds: OverlayRect): number {
  return clamp(Math.round(ballY), bounds.y, bounds.y + bounds.height - FLOATING_BALL_SIZE)
}

function offScreenBallOrigin(
  side: FloatingDockSide,
  ballY: number,
  bounds: OverlayRect,
): { x: number; y: number } {
  const y = clampBallY(ballY, bounds)
  return {
    x: side === 'left'
      ? bounds.x - FLOATING_BALL_SIZE - FLOATING_DOCK_OFF_GAP
      : bounds.x + bounds.width + FLOATING_DOCK_OFF_GAP,
    y,
  }
}

function insideBallOrigin(
  side: FloatingDockSide,
  ballY: number,
  display: { readonly bounds: OverlayRect; readonly workArea: OverlayRect },
): { x: number; y: number } {
  return {
    x: side === 'left'
      ? display.bounds.x + FLOATING_DOCK_IN_PAD
      : display.bounds.x + display.bounds.width - FLOATING_BALL_SIZE - FLOATING_DOCK_IN_PAD,
    y: clamp(
      Math.round(ballY),
      display.workArea.y,
      display.workArea.y + display.workArea.height - FLOATING_BALL_SIZE,
    ),
  }
}

function staysDocked(
  side: FloatingDockSide,
  cursorX: number,
  bounds: OverlayRect,
): boolean {
  if (side === 'right') return cursorX >= bounds.x + bounds.width - FLOATING_DOCK_DRAG_OFF
  return cursorX <= bounds.x + FLOATING_DOCK_DRAG_OFF
}

function overlayDestroyed(window: BrowserWindow): boolean {
  return typeof window.isDestroyed === 'function' && window.isDestroyed()
}

function prefersReducedMotion(): boolean {
  return systemPreferences.getAnimationSettings?.().prefersReducedMotion === true
}

function shouldAnimateDock(window: BrowserWindow): boolean {
  return process.env.VITEST !== 'true' && !overlayDestroyed(window) && !prefersReducedMotion()
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function lerpRect(start: OverlayRect, end: OverlayRect, t: number): OverlayRect {
  return {
    x: Math.round(start.x + (end.x - start.x) * t),
    y: Math.round(start.y + (end.y - start.y) * t),
    width: Math.round(start.width + (end.width - start.width) * t),
    height: Math.round(start.height + (end.height - start.height) * t),
  }
}

function cancelOverlayAnim(window: BrowserWindow): void {
  const anim = overlayAnim.get(window)
  if (anim === undefined) return
  anim.cancelled = true
  anim.resolve()
  overlayAnim.delete(window)
}

function animateOverlayBounds(
  window: BrowserWindow,
  end: OverlayRect,
  durationMs: number,
  ease: (t: number) => number,
): Promise<void> {
  cancelOverlayAnim(window)
  const start = window.getBounds()
  if (!shouldAnimateDock(window) || durationMs <= 0) {
    window.setBounds(end)
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const anim: OverlayAnim = { cancelled: false, resolve }
    overlayAnim.set(window, anim)
    const t0 = Date.now()
    const tick = (): void => {
      if (anim.cancelled) return
      if (overlayDestroyed(window)) {
        overlayAnim.delete(window)
        resolve()
        return
      }
      const t = Math.min(1, (Date.now() - t0) / durationMs)
      window.setBounds(lerpRect(start, end, ease(t)))
      if (t < 1) {
        setTimeout(tick, 16)
        return
      }
      overlayAnim.delete(window)
      resolve()
    }
    setTimeout(tick, 16)
  })
}

function applyDockedTab(
  window: BrowserWindow,
  side: FloatingDockSide,
  ballY: number,
  bounds: OverlayRect,
): FloatingDockState {
  const y = clampBallY(ballY, bounds)
  overlayDock.set(window, { side, y })
  cancelOverlayAnim(window)
  window.setBounds(dockedTabBounds(side, y, bounds))
  return { docked: side }
}

async function snapToEdge(
  window: BrowserWindow,
  side: FloatingDockSide,
  ballY: number,
  bounds: OverlayRect,
): Promise<FloatingDockState> {
  const y = clampBallY(ballY, bounds)
  overlayDock.set(window, { side, y })
  await animateOverlayBounds(
    window,
    collapsedWindowBounds(offScreenBallOrigin(side, y, bounds)),
    FLOATING_DOCK_SLIDE_OFF_MS,
    easeInOutCubic,
  )
  if (overlayDestroyed(window)) return { docked: undefined }
  const docked = overlayDock.get(window)
  if (docked === undefined || docked.side !== side) return { docked: docked?.side }
  window.setBounds(dockedTabBounds(side, y, bounds))
  return { docked: side }
}

function clearDock(window: BrowserWindow): void {
  overlayDock.delete(window)
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

function windowCenter(bounds: OverlayRect): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

function currentBallOrigin(window: BrowserWindow, workArea: OverlayRect): { x: number; y: number } {
  const bounds = window.getBounds()
  const docked = overlayDock.get(window)
  if (docked !== undefined) {
    return insideBallOrigin(docked.side, docked.y, displayGeometry(windowCenter(bounds)))
  }
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
 * @param millifraction - optional millifraction-coordinates default toggle.
 * @returns the overlay window.
 */
export function createFloatingWindow(
  preload: string,
  messages: DesktopMessages,
  onOpenMain: () => void,
  onQuit: () => void,
  selection?: { readonly enabled: () => boolean; readonly toggle: () => void },
  agents?: FloatingAgentMenuSource,
  millifraction?: { readonly enabled: () => boolean; readonly toggle: () => void },
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
    // A frameless panel keeps a hidden titlebar unless corners are square. That strip activates the app.
    roundedCorners: false,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  window.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, FLOATING_OVERLAY_ALWAYS_ON_TOP_RELATIVE)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('context-menu', (_event, params) => {
    void popupFloatingContextMenu(
      window,
      params,
      messages,
      onOpenMain,
      onQuit,
      selection,
      agents,
      millifraction,
    )
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
  millifraction: { readonly enabled: () => boolean; readonly toggle: () => void } | undefined,
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
    millifraction === undefined
      ? undefined
      : { enabled: millifraction.enabled(), onToggle: millifraction.toggle },
  )).popup({ window })
}

/**
 * Resize the overlay between ball and panel while keeping the ball origin fixed.
 * Expanding clears a docked tab. Collapsing while still docked restores the tab.
 * @param window - floating overlay.
 * @param expanded - whether the transcript panel is visible.
 * @returns growth used for renderer layout, plus the dock side when the tab remains.
 */
export function setFloatingExpanded(window: BrowserWindow, expanded: boolean): FloatingExpandState {
  const bounds = window.getBounds()
  const display = displayGeometry(windowCenter(bounds))
  const workArea = display.workArea
  if (expanded) {
    const origin = currentBallOrigin(window, workArea)
    clearDock(window)
    const next = expandedOverlayBounds(origin, workArea)
    overlayDirection.set(window, { horizontal: next.horizontal, vertical: next.vertical })
    window.setBounds({ x: next.x, y: next.y, width: next.width, height: next.height })
    return expandState(true, next, undefined)
  }
  const direction = overlayDirection.get(window) ?? expandDirection({ x: bounds.x, y: bounds.y }, workArea)
  const docked = overlayDock.get(window)
  if (docked !== undefined) {
    applyDockedTab(window, docked.side, docked.y, display.bounds)
    return expandState(false, direction, docked.side)
  }
  const origin = clampedBallOrigin(currentBallOrigin(window, workArea), workArea)
  window.setBounds(collapsedWindowBounds(origin))
  return expandState(false, direction, undefined)
}

/**
 * Move the overlay so the 72px ball origin follows `(x, y)`.
 * A collapsed ball may hang past a display edge; dock is committed on clamp, not here.
 * Dragging a docked tab inward past {@link FLOATING_DOCK_DRAG_OFF} clears dock.
 * An expanded overlay keeps its stored growth and does not dock.
 * @param window - floating overlay.
 * @param x - ball top-left x in screen coordinates, or cursor x while dragging a docked tab.
 * @param y - ball top-left y in screen coordinates.
 * @param canDock - when false, never keep a docked tab (running, asking, or TCC).
 * @returns the dock side after this move, if any.
 */
export function moveFloatingBall(
  window: BrowserWindow,
  x: number,
  y: number,
  canDock = true,
): FloatingDockState {
  const origin = { x: Math.round(x), y: Math.round(y) }
  const bounds = window.getBounds()
  if (!isCollapsedOverlay(bounds) && overlayDock.get(window) === undefined) {
    const stored = overlayDirection.get(window)
    const direction = stored ?? expandDirection(origin, workAreaOf(origin))
    window.setBounds(overlayBoundsFromBall(origin, direction))
    return { docked: undefined }
  }
  if (!canDock) {
    clearDock(window)
    cancelOverlayAnim(window)
    window.setBounds(collapsedWindowBounds(origin))
    return { docked: undefined }
  }
  const display = displayGeometry(origin)
  const existing = overlayDock.get(window)
  if (existing !== undefined && staysDocked(existing.side, origin.x, display.bounds)) {
    return applyDockedTab(window, existing.side, existing.y, display.bounds)
  }
  clearDock(window)
  cancelOverlayAnim(window)
  window.setBounds(collapsedWindowBounds(origin))
  return { docked: undefined }
}

/**
 * Keep a free-floating overlay inside the nearest work area, or dock on pointer-up
 * when a collapsed ball already overlaps a left or right display edge by {@link FLOATING_DOCK_OVERLAP}.
 * A docked tab stays docked; this does not dock a ball that is only flush with an edge.
 * @param window - floating overlay.
 * @param canDock - when false, never enter a docked tab (running, asking, or TCC).
 * @returns the dock side after clamp, if any.
 */
export async function clampFloatingWindow(
  window: BrowserWindow,
  canDock = true,
): Promise<FloatingDockState> {
  const bounds = window.getBounds()
  const display = displayGeometry(windowCenter(bounds))
  const docked = overlayDock.get(window)
  if (docked !== undefined) {
    applyDockedTab(window, docked.side, docked.y, display.bounds)
    return { docked: docked.side }
  }
  if (isCollapsedOverlay(bounds)) {
    const origin = {
      x: bounds.x + FLOATING_CHROME_INSET,
      y: bounds.y + FLOATING_CHROME_INSET,
    }
    if (canDock) {
      const side = dockSideForBallOrigin(origin, display.bounds)
      if (side !== undefined) return snapToEdge(window, side, origin.y, display.bounds)
    }
    window.setBounds(collapsedWindowBounds(clampedBallOrigin(origin, display.workArea)))
    return { docked: undefined }
  }
  setFloatingExpanded(window, true)
  return { docked: undefined }
}

/**
 * Slide the 72px ball back on-screen from a docked tab and clear dock.
 * No-op when the overlay is not docked.
 * @param window - floating overlay.
 * @returns `{ docked: undefined }` after unsnap.
 */
export async function unsnapDockedBall(window: BrowserWindow): Promise<FloatingDockState> {
  const docked = overlayDock.get(window)
  if (docked === undefined) return { docked: undefined }
  const display = displayGeometry(windowCenter(window.getBounds()))
  const start = offScreenBallOrigin(docked.side, docked.y, display.bounds)
  const end = insideBallOrigin(docked.side, docked.y, display)
  clearDock(window)
  window.setBounds(collapsedWindowBounds(start))
  await animateOverlayBounds(
    window,
    collapsedWindowBounds(end),
    FLOATING_DOCK_SLIDE_IN_MS,
    easeOutCubic,
  )
  return { docked: undefined }
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
 * @param windows - floating ball, selection toolbar, observation frame, or other capture-excluded chrome.
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
