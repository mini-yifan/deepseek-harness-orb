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
  /** Reserved agent-strip width on the far edge; 0 when there is nothing to show. */
  readonly strip: number
}

/**
 * Contact tolerance that still counts as reaching a left or right display edge on release.
 * Any contact with the edge docks on release; this only absorbs the rounding of the final placement.
 * Windows quantizes window bounds to whole device pixels, so a ball placed flush against the edge
 * can read back a pixel or two short when `physicalWidth / scaleFactor` is not an integer
 * (1920/1.5, 2560/1.25, 3840/1.75). The drag itself never depends on that read-back.
 */
export const FLOATING_DOCK_OVERLAP = 3

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

/**
 * Reserve on the panel's far edge for the background-agent strip.
 * Sized for the fully hover-expanded chip row; collapsed chips sit at the
 * panel-side edge inside it.
 */
export const FLOATING_AGENT_STRIP_WIDTH = 208

/**
 * Chromium turns a DIP window size into device pixels with an enclosing rect, then converts
 * it back the same way. Whenever `size * scaleFactor` is not an integer (120% is 115.2), a
 * 96px ball window can read back 97. The panel is hundreds of pixels larger, so a few DIP
 * still cannot be the panel.
 */
const BALL_WINDOW_SLOP = 4

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

/** Cursor offset inside the ball, recorded at press and kept for the whole gesture. */
const overlayGrab = new WeakMap<BrowserWindow, { readonly x: number; readonly y: number }>()

/** Set once the renderer reports that the gesture passed the drag threshold. */
const overlayDragging = new WeakMap<BrowserWindow, boolean>()

/**
 * Ball origin last requested. The OS read-back is not a safe dock input on Windows once
 * the scale is above 100%: the window is kept inside the monitor, so the 12px transparent
 * chrome leaves the ball a chrome-width short of the edge it was aimed at.
 */
const overlayPlacedOrigin = new WeakMap<BrowserWindow, { readonly x: number; readonly y: number }>()

/** Agent-strip width reserved on the panel's far edge; 0 when the strip is hidden. */
const overlayStrip = new WeakMap<BrowserWindow, number>()

interface OverlayAnim {
  cancelled: boolean
  resolve: () => void
}

const overlayAnim = new WeakMap<BrowserWindow, OverlayAnim>()

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function isCollapsedOverlay(bounds: OverlayRect): boolean {
  return bounds.width <= FLOATING_BALL_WINDOW_SIZE + BALL_WINDOW_SLOP
    && bounds.height <= FLOATING_BALL_WINDOW_SIZE + BALL_WINDOW_SLOP
}

/** Whether the bounds still draw the full ball window, including a slide-off still in flight. */
function drawsBall(bounds: OverlayRect): boolean {
  return Math.abs(bounds.width - FLOATING_BALL_WINDOW_SIZE) <= BALL_WINDOW_SLOP
    && Math.abs(bounds.height - FLOATING_BALL_WINDOW_SIZE) <= BALL_WINDOW_SLOP
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
  strip: number,
): FloatingExpandState {
  return { expanded, horizontal: direction.horizontal, vertical: direction.vertical, docked, strip }
}

/**
 * Which outer display edge the ball reaches on release; contact within
 * {@link FLOATING_DOCK_OVERLAP} docks. Top and bottom never dock. Dock itself is
 * committed on pointer-up, not during the drag. An edge that touches another display
 * is a seam, not a place to dock.
 * @param ball - 72px ball top-left.
 * @param bounds - containing display `bounds` (screen edge, not work area).
 * @param displays - every display bounds; an edge shared with another display is a seam.
 * @returns the dock side, or `undefined` when the ball is clear of both side edges.
 */
export function dockSideForBallOrigin(
  ball: { readonly x: number; readonly y: number },
  bounds: OverlayRect,
  displays: readonly OverlayRect[] = [],
): FloatingDockSide | undefined {
  const leftGap = bounds.x - ball.x
  const rightGap = ball.x + FLOATING_BALL_SIZE - (bounds.x + bounds.width)
  // The nearer edge wins, so a display narrower than the ball cannot dock both ways.
  let side: FloatingDockSide | undefined
  if (leftGap >= rightGap && leftGap >= -FLOATING_DOCK_OVERLAP) side = 'left'
  else if (rightGap > leftGap && rightGap >= -FLOATING_DOCK_OVERLAP) side = 'right'
  if (side === undefined || edgeTouchesDisplay(side, bounds, displays)) return undefined
  return side
}

/** Whether a left or right display edge sits within 8 DIP of another display, which makes it a seam. */
function edgeTouchesDisplay(
  side: FloatingDockSide,
  bounds: OverlayRect,
  displays: readonly OverlayRect[],
): boolean {
  const edge = side === 'left' ? bounds.x : bounds.x + bounds.width
  for (const other of displays) {
    if (sameRect(other, bounds)) continue
    const otherEdge = side === 'left' ? other.x + other.width : other.x
    if (Math.abs(otherEdge - edge) > 8) continue
    const top = Math.max(bounds.y, other.y)
    const bottom = Math.min(bounds.y + bounds.height, other.y + other.height)
    if (bottom > top) return true
  }
  return false
}

function sameRect(left: OverlayRect, right: OverlayRect): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height
}

/** Every display bounds; the seam check needs all of them, not only the nearest one. */
function allDisplayBounds(): readonly OverlayRect[] {
  return screen.getAllDisplays().map(display => display.bounds)
}

/**
 * Overlay rectangle for the docked tab flush with a work-area edge.
 * A side taskbar lives outside the work area, so a tab on the display bounds would sit under it.
 * @param side - left or right display edge.
 * @param ballY - 72px ball top used to center the tab vertically.
 * @param workArea - containing display work area.
 * @returns a hittable strip {@link FLOATING_DOCK_HIT_WIDTH} by {@link FLOATING_DOCK_HIT_HEIGHT}.
 */
export function dockedTabBounds(
  side: FloatingDockSide,
  ballY: number,
  workArea: OverlayRect,
): OverlayRect {
  const y = clamp(
    Math.round(ballY - FLOATING_DOCK_GLOW),
    workArea.y,
    workArea.y + workArea.height - FLOATING_DOCK_HIT_HEIGHT,
  )
  return {
    x: side === 'left' ? workArea.x : workArea.x + workArea.width - FLOATING_DOCK_HIT_WIDTH,
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

/** Ball origin of a slide-in. It lands inside the work area: side taskbars live outside it. */
function insideBallOrigin(
  side: FloatingDockSide,
  ballY: number,
  display: { readonly bounds: OverlayRect; readonly workArea: OverlayRect },
): { x: number; y: number } {
  return {
    x: side === 'left'
      ? display.workArea.x + FLOATING_DOCK_IN_PAD
      : display.workArea.x + display.workArea.width - FLOATING_BALL_SIZE - FLOATING_DOCK_IN_PAD,
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
  workArea: OverlayRect,
): FloatingDockState {
  const y = clampBallY(ballY, workArea)
  overlayDock.set(window, { side, y })
  cancelOverlayAnim(window)
  window.setBounds(dockedTabBounds(side, y, workArea))
  return { docked: side }
}

async function snapToEdge(
  window: BrowserWindow,
  side: FloatingDockSide,
  ballY: number,
  display: { readonly bounds: OverlayRect; readonly workArea: OverlayRect },
): Promise<FloatingDockState> {
  const y = clampBallY(ballY, display.workArea)
  overlayDock.set(window, { side, y })
  // The slide-off leaves the screen, so it uses the display bounds; the tab it lands on
  // is flush with the work area, where a side taskbar is not in the way.
  await animateOverlayBounds(
    window,
    collapsedWindowBounds(offScreenBallOrigin(side, y, display.bounds)),
    FLOATING_DOCK_SLIDE_OFF_MS,
    easeInOutCubic,
  )
  if (overlayDestroyed(window)) return { docked: undefined }
  const docked = overlayDock.get(window)
  if (docked === undefined || docked.side !== side) return { docked: docked?.side }
  window.setBounds(dockedTabBounds(side, y, display.workArea))
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
  stripWidth = 0,
): OverlayRect & { horizontal: FloatingHorizontalExpand; vertical: FloatingVerticalExpand } {
  const direction = expandDirection(ball, workArea)
  const unclamped = overlayBoundsFromBall(ball, direction, stripWidth)
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
  stripWidth = 0,
): OverlayRect {
  const width = FLOATING_PANEL_WINDOW_SIZE.width + stripWidth
  const height = FLOATING_PANEL_WINDOW_SIZE.height
  return {
    // The strip widens the far edge only; the ball-anchored near edge is untouched,
    // so `ballOriginFromWindow` needs no strip awareness.
    x: direction.horizontal === 'left'
      ? ball.x - (FLOATING_PANEL_SIZE.width - FLOATING_BALL_SIZE) - FLOATING_CHROME_INSET - stripWidth
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
  // A docked window at rest is the thin tab. While the slide-off still draws the full ball
  // window, the ball is wherever that window is, not at its docked pose.
  if (docked !== undefined && !drawsBall(bounds)) {
    return insideBallOrigin(docked.side, docked.y, displayGeometry(windowCenter(bounds)))
  }
  if (isCollapsedOverlay(bounds)) {
    return { x: bounds.x + FLOATING_CHROME_INSET, y: bounds.y + FLOATING_CHROME_INSET }
  }
  const stored = overlayDirection.get(window) ?? expandDirection({ x: bounds.x, y: bounds.y }, workArea)
  return ballOriginFromWindow(bounds, stored)
}

/** Stop a slide-off that still draws the ball window; the ball stays free where it is. */
function stopSlideOff(window: BrowserWindow): void {
  const docked = overlayDock.get(window)
  if (docked !== undefined && drawsBall(window.getBounds())) {
    clearDock(window)
    cancelOverlayAnim(window)
  }
}

/** The layout the page must apply, as the window stands now. */
function floatingExpandState(window: BrowserWindow): FloatingExpandState {
  const bounds = window.getBounds()
  const docked = overlayDock.get(window)?.side
  const direction = overlayDirection.get(window)
    ?? expandDirection({ x: bounds.x, y: bounds.y }, displayGeometry(windowCenter(bounds)).workArea)
  return expandState(!isCollapsedOverlay(bounds) && docked === undefined, direction, docked, overlayStrip.get(window) ?? 0)
}

/**
 * Keep a transparent overlay above other windows.
 * macOS uses a panel on every Space. Windows uses the screen-saver always-on-top level
 * because `type: 'panel'` and `setVisibleOnAllWorkspaces` are Darwin-only.
 * @param window - floating ball or selection toolbar.
 */
export function presentOverlayWindow(window: BrowserWindow): void {
  if (process.platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    return
  }
  if (process.platform === 'win32') window.setAlwaysOnTop(true, 'screen-saver')
}

/**
 * Construct the overlay BrowserWindow. The caller loads `dsh-app://shell/floating.html`.
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
    ...process.platform === 'win32' ? {} : { type: 'panel' as const },
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
  presentOverlayWindow(window)
  if (process.platform === 'darwin') {
    window.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, FLOATING_OVERLAY_ALWAYS_ON_TOP_RELATIVE)
  }
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
  // Any explicit placement stops a slide still in flight, or its frames would overwrite
  // the window this call just set.
  cancelOverlayAnim(window)
  const strip = overlayStrip.get(window) ?? 0
  if (expanded) {
    const origin = currentBallOrigin(window, workArea)
    clearDock(window)
    const next = expandedOverlayBounds(origin, workArea, strip)
    overlayDirection.set(window, { horizontal: next.horizontal, vertical: next.vertical })
    window.setBounds({ x: next.x, y: next.y, width: next.width, height: next.height })
    return expandState(true, next, undefined, strip)
  }
  const direction = overlayDirection.get(window) ?? expandDirection({ x: bounds.x, y: bounds.y }, workArea)
  const docked = overlayDock.get(window)
  if (docked !== undefined) {
    applyDockedTab(window, docked.side, docked.y, workArea)
    return expandState(false, direction, docked.side, strip)
  }
  const origin = clampedBallOrigin(currentBallOrigin(window, workArea), workArea)
  window.setBounds(collapsedWindowBounds(origin))
  return expandState(false, direction, undefined, strip)
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
  overlayPlacedOrigin.set(window, origin)
  const bounds = window.getBounds()
  if (!isCollapsedOverlay(bounds) && overlayDock.get(window) === undefined) {
    const stored = overlayDirection.get(window)
    const direction = stored ?? expandDirection(origin, workAreaOf(origin))
    window.setBounds(overlayBoundsFromBall(origin, direction, overlayStrip.get(window) ?? 0))
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
    return applyDockedTab(window, existing.side, existing.y, display.workArea)
  }
  clearDock(window)
  cancelOverlayAnim(window)
  window.setBounds(collapsedWindowBounds(origin))
  return { docked: undefined }
}

/**
 * Reserve (or free) agent-strip width on the panel's far edge. While expanded the
 * window re-bounds immediately around the fixed ball origin; while collapsed the
 * value is stored for the next expand.
 * @param window - floating overlay.
 * @param width - reserved width in CSS pixels; 0 frees the reserve.
 * @returns overlay size, growth, dock side, and the stored strip width.
 */
export function setFloatingStrip(window: BrowserWindow, width: number): FloatingExpandState {
  const next = Math.max(0, Math.round(width))
  const stored = overlayStrip.get(window) ?? 0
  if (next === stored) return floatingExpandState(window)
  overlayStrip.set(window, next)
  const bounds = window.getBounds()
  if (!isCollapsedOverlay(bounds) && overlayDock.get(window) === undefined) {
    const display = displayGeometry(windowCenter(bounds))
    const origin = currentBallOrigin(window, display.workArea)
    const nextBounds = expandedOverlayBounds(origin, display.workArea, next)
    overlayDirection.set(window, { horizontal: nextBounds.horizontal, vertical: nextBounds.vertical })
    window.setBounds({ x: nextBounds.x, y: nextBounds.y, width: nextBounds.width, height: nextBounds.height })
  }
  return floatingExpandState(window)
}

/**
 * Keep a free-floating overlay inside the nearest work area, or dock on pointer-up
 * when a collapsed ball reaches a left or right display edge within {@link FLOATING_DOCK_OVERLAP}.
 * The decision uses the origin the drag requested: the window the OS actually applied can sit
 * short of that on a scaled Windows display. A docked tab stays docked.
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
    applyDockedTab(window, docked.side, docked.y, display.workArea)
    return { docked: docked.side }
  }
  if (isCollapsedOverlay(bounds)) {
    const origin = overlayPlacedOrigin.get(window) ?? {
      x: bounds.x + FLOATING_CHROME_INSET,
      y: bounds.y + FLOATING_CHROME_INSET,
    }
    if (canDock) {
      const side = dockSideForBallOrigin(origin, display.bounds, allDisplayBounds())
      if (side !== undefined) return snapToEdge(window, side, origin.y, display)
    }
    window.setBounds(collapsedWindowBounds(clampedBallOrigin(origin, display.workArea)))
    return { docked: undefined }
  }
  setFloatingExpanded(window, true)
  return { docked: undefined }
}

/**
 * Pointer pressed on the ball. The grab offset comes from the OS cursor and the ball origin
 * the window really has, both in the DIP space `setBounds` uses, so the drag never reads a
 * renderer-side window position.
 * @param window - floating overlay.
 * @param cursor - current OS cursor point.
 */
export function pressFloatingBall(window: BrowserWindow, cursor: { readonly x: number; readonly y: number }): void {
  stopSlideOff(window)
  const display = displayGeometry(windowCenter(window.getBounds()))
  const origin = currentBallOrigin(window, display.workArea)
  overlayGrab.set(window, { x: cursor.x - origin.x, y: cursor.y - origin.y })
  overlayDragging.set(window, false)
}

/**
 * The gesture passed the drag threshold; from here the ball follows the cursor.
 * @param window - floating overlay.
 */
export function beginFloatingDrag(window: BrowserWindow): void {
  overlayDragging.set(window, overlayGrab.has(window))
}

/**
 * Follow the cursor. Stateless on purpose: the target is always cursor minus grab,
 * so the window moving cannot feed back into the next target.
 * @param window - floating overlay.
 * @param cursor - current OS cursor point.
 * @param canDock - when false, never keep a docked tab (running, asking, or TCC).
 * @returns the dock side after this move, if any.
 */
export function dragFloatingBall(
  window: BrowserWindow,
  cursor: { readonly x: number; readonly y: number },
  canDock = true,
): FloatingDockState {
  const docked = overlayDock.get(window)
  if (overlayDragging.get(window) !== true) return { docked: docked?.side }
  const grab = overlayGrab.get(window)
  if (grab === undefined) return { docked: docked?.side }
  return moveFloatingBall(window, cursor.x - grab.x, cursor.y - grab.y, canDock)
}

/**
 * Release. The ball is placed under the cursor, then docked on a side edge or pulled back
 * into the work area. The result is the full layout the page must show, including the panel
 * direction when a running panel re-anchored.
 * @param window - floating overlay.
 * @param cursor - current OS cursor point.
 * @param canDock - when false, never enter a docked tab (running, asking, or TCC).
 * @returns overlay size, growth, and dock side after the release.
 */
export async function endFloatingDrag(
  window: BrowserWindow,
  cursor: { readonly x: number; readonly y: number },
  canDock = true,
): Promise<FloatingExpandState> {
  const grab = overlayGrab.get(window)
  const dragging = overlayDragging.get(window) === true
  overlayGrab.delete(window)
  overlayDragging.delete(window)
  if (grab === undefined || !dragging) return floatingExpandState(window)
  moveFloatingBall(window, cursor.x - grab.x, cursor.y - grab.y, canDock)
  await clampFloatingWindow(window, canDock)
  logDockRelease(window, cursor)
  return floatingExpandState(window)
}

/**
 * Print one release diagnosis line to stderr when `DSH_ORB_DOCK_DEBUG=1`, so a DPI or
 * multi-display dock report can be diagnosed without reproducing it locally.
 * @param window - floating overlay after the release.
 * @param cursor - OS cursor point at the release.
 */
function logDockRelease(window: BrowserWindow, cursor: { readonly x: number; readonly y: number }): void {
  if (process.env.DSH_ORB_DOCK_DEBUG !== '1') return
  const displays = screen.getAllDisplays().map(display => ({
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
  }))
  console.error(`[orb-dock] ${JSON.stringify({
    cursor,
    bounds: window.getBounds(),
    displays,
    docked: overlayDock.get(window)?.side ?? null,
  })}`)
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
 * Parse the overlay's `desktopCapturer` source id into a window id.
 * The number is a CGWindowID on macOS and an HWND on Windows. Both use `window:<id>:…`.
 * @param sourceId - `BrowserWindow.getMediaSourceId()` value.
 * @returns the window id Computer Use excludes from the observation.
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
 * Overlay window ids Computer Use must omit from the next capture.
 * macOS passes them to ScreenCaptureKit. Windows skips those HWNDs when choosing the foreground window.
 * Hidden windows are omitted: ScreenCaptureKit `onScreenWindowsOnly` cannot see them,
 * and a missing exclude id fails macOS capture.
 * @param windows - floating ball, selection toolbar, observation frame, or other capture-excluded chrome.
 * @returns window ids, omitting destroyed or hidden windows.
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
  // Windows GDI honors WDA_EXCLUDEFROMCAPTURE. Hold it for capture and for HID,
  // because the post-action screenshot runs inside the input cloak and does not send a second capture begin.
  // macOS exclusion stays on ScreenCaptureKit ids.
  window.setContentProtection(process.platform === 'win32' && (counts.capture > 0 || counts.input > 0))
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
 * Capture begin still refcounts so overlapping sessions stay paired with their ends.
 * macOS omits the overlay with {@link overlayWindowExcludeIds}. Windows sets
 * `contentProtection` for capture and for the HID interval that wraps recapture.
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
  window.setContentProtection(false)
  window.setIgnoreMouseEvents(false)
}
