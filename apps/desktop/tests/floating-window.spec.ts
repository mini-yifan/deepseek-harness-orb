import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class FakeBrowserWindow { readonly kind = 'window' },
  Menu: { buildFromTemplate: vi.fn() },
  screen: {
    getDisplayNearestPoint: vi.fn(),
    getPrimaryDisplay: vi.fn(),
    getAllDisplays: vi.fn(() => []),
  },
  systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: false }) },
}))

import {
  applyFloatingOverlayGuard,
  ballOriginFromWindow,
  beginFloatingDrag,
  cgWindowIdFromMediaSourceId,
  clampFloatingWindow,
  clampedBallOrigin,
  defaultFloatingBallOrigin,
  dockedTabBounds,
  dockSideForBallOrigin,
  dragFloatingBall,
  endFloatingDrag,
  expandDirection,
  expandedOverlayBounds,
  floatingContextMenuTemplate,
  FLOATING_AGENT_STRIP_WIDTH,
  FLOATING_BALL_DEFAULT_BELOW_CENTER,
  FLOATING_BALL_SIZE,
  FLOATING_BALL_WINDOW_SIZE,
  FLOATING_CHROME_INSET,
  FLOATING_DOCK_DRAG_OFF,
  FLOATING_DOCK_HIT_HEIGHT,
  FLOATING_DOCK_HIT_WIDTH,
  FLOATING_DOCK_IN_PAD,
  FLOATING_DOCK_OVERLAP,
  FLOATING_DOCK_TAB_FILL,
  FLOATING_DOCK_TAB_HEIGHT,
  FLOATING_DOCK_TAB_WIDTH,
  FLOATING_PANEL_SIZE,
  FLOATING_PANEL_WINDOW_SIZE,
  moveFloatingBall,
  overlayWindowExcludeIds,
  pressFloatingBall,
  resetFloatingOverlayGuard,
  setFloatingExpanded,
  setFloatingStrip,
  unsnapDockedBall,
} from '../src/floating-window.ts'

const workArea = { x: 100, y: 50, width: 1000, height: 800 }
const messages = {
  floatingOpenMain: 'Open Main Window',
  floatingAgentSettings: 'Floating Agent Settings',
  floatingBackgroundAgentSettings: 'Background Agent Settings',
  floatingNoModels: 'No models available.',
  floatingEffortDefault: 'Default',
  floatingQuit: 'Quit DeepSeek Orb',
  selectionToolbarEnable: 'Enable Selection Toolbar',
  selectionToolbarDisable: 'Disable Selection Toolbar',
  millifractionEnable: 'Enable millifraction coordinates',
  millifractionDisable: 'Disable millifraction coordinates',
}

function collapsedAt(x: number, y: number) {
  return {
    x: x - FLOATING_CHROME_INSET,
    y: y - FLOATING_CHROME_INSET,
    width: FLOATING_BALL_WINDOW_SIZE,
    height: FLOATING_BALL_WINDOW_SIZE,
  }
}

const screenBounds = { x: 0, y: 0, width: 1440, height: 900 }

function overlayAt(x: number, y: number) {
  return {
    bounds: collapsedAt(x, y),
    getBounds() { return this.bounds },
    setBounds(next: { x: number; y: number; width: number; height: number }) {
      this.bounds = { ...next }
    },
  }
}

async function mockScreen() {
  const { screen } = await import('electron')
  vi.mocked(screen.getDisplayNearestPoint).mockReturnValue({
    bounds: screenBounds,
    workArea,
  } as never)
}

describe('floating window expand geometry', () => {
  const expandedAt = (ballX: number, ballY: number, horizontal: 'left' | 'right', vertical: 'up' | 'down') => ({
    x: horizontal === 'left'
      ? ballX - (FLOATING_PANEL_SIZE.width - FLOATING_BALL_SIZE) - FLOATING_CHROME_INSET
      : ballX - FLOATING_CHROME_INSET,
    y: vertical === 'up'
      ? ballY - (FLOATING_PANEL_SIZE.height - FLOATING_BALL_SIZE) - FLOATING_CHROME_INSET
      : ballY - FLOATING_CHROME_INSET,
    width: FLOATING_PANEL_WINDOW_SIZE.width,
    height: FLOATING_PANEL_WINDOW_SIZE.height,
  })

  it('keeps CSS --chrome equal to FLOATING_CHROME_INSET', () => {
    const css = readFileSync(new URL('../renderer/floating.css', import.meta.url), 'utf8')
    expect(css).toContain(`--chrome: ${String(FLOATING_CHROME_INSET)}px`)
  })

  it('grows left and up when the ball sits on the right and has space above', () => {
    expect(expandDirection({ x: 900, y: 400 }, workArea)).toEqual({ horizontal: 'left', vertical: 'up' })
    expect(expandedOverlayBounds({ x: 900, y: 400 }, workArea)).toEqual({
      ...expandedAt(900, 400, 'left', 'up'),
      horizontal: 'left',
      vertical: 'up',
    })
  })

  it('grows right and down when the ball is near the top-left', () => {
    expect(expandDirection({ x: 120, y: 60 }, workArea)).toEqual({ horizontal: 'right', vertical: 'down' })
    expect(expandedOverlayBounds({ x: 120, y: 60 }, workArea)).toMatchObject({
      ...expandedAt(120, 60, 'right', 'down'),
      horizontal: 'right',
      vertical: 'down',
    })
  })

  it('keeps the ball origin in the growth corner of an expanded overlay', () => {
    const expanded = expandedOverlayBounds({ x: 900, y: 400 }, workArea)
    expect(ballOriginFromWindow(expanded, expanded)).toEqual({ x: 900, y: 400 })
  })

  it('clamps a ball inside the work area without snapping to an edge', () => {
    expect(clampedBallOrigin({ x: 80, y: 40 }, workArea)).toEqual({ x: 100, y: 50 })
    expect(clampedBallOrigin({ x: 400, y: 300 }, workArea)).toEqual({ x: 400, y: 300 })
  })

  it('places the default origin on the work-area right edge, slightly below center', () => {
    expect(defaultFloatingBallOrigin(workArea)).toEqual({
      x: 100 + 1000 - FLOATING_BALL_SIZE,
      y: Math.round(50 + (800 - FLOATING_BALL_SIZE) / 2 + 800 * FLOATING_BALL_DEFAULT_BELOW_CENTER),
    })
  })

  it('clamps a default origin that would leave the work area', () => {
    const short = { x: 0, y: 0, width: 200, height: 80 }
    expect(defaultFloatingBallOrigin(short)).toEqual({
      x: 200 - FLOATING_BALL_SIZE,
      y: 80 - FLOATING_BALL_SIZE,
    })
  })

  it('resizes the overlay while keeping the ball origin and clamps without edge snap', async () => {
    const { screen } = await import('electron')
    vi.mocked(screen.getDisplayNearestPoint).mockReturnValue({
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea,
    } as never)
    const window = {
      getBounds: vi.fn(() => collapsedAt(900, 400)),
      setBounds: vi.fn(),
      setPosition: vi.fn(),
    }
    expect(setFloatingExpanded(window as never, true)).toEqual({
      expanded: true,
      horizontal: 'left',
      vertical: 'up',
      docked: undefined,
      strip: 0,
    })
    expect(window.setBounds).toHaveBeenCalledWith(expandedAt(900, 400, 'left', 'up'))
    window.getBounds.mockReturnValue(collapsedAt(80, 40))
    await clampFloatingWindow(window as never)
    expect(window.setBounds).toHaveBeenCalledWith(collapsedAt(100, 50))
    expect(window.setPosition).not.toHaveBeenCalled()
  })

  it('reserves agent-strip width on the far edge and keeps the ball origin', async () => {
    await mockScreen()
    const window = overlayAt(900, 400)
    const expanded = setFloatingExpanded(window as never, true)
    const panelBounds = { ...window.bounds }
    const state = setFloatingStrip(window as never, FLOATING_AGENT_STRIP_WIDTH)
    expect(state.strip).toBe(FLOATING_AGENT_STRIP_WIDTH)
    expect(state.expanded).toBe(true)
    expect(window.bounds.width).toBe(panelBounds.width + FLOATING_AGENT_STRIP_WIDTH)
    expect(window.bounds.x).toBe(panelBounds.x - FLOATING_AGENT_STRIP_WIDTH)
    expect(ballOriginFromWindow(window.bounds, state)).toEqual({ x: 900, y: 400 })
    const freed = setFloatingStrip(window as never, 0)
    expect(freed.strip).toBe(0)
    expect(window.bounds).toEqual(panelBounds)
    expect(expanded.strip).toBe(0)
  })

  it('moves an expanded overlay by ball origin without clamping the panel', async () => {
    const { screen } = await import('electron')
    vi.mocked(screen.getDisplayNearestPoint).mockReturnValue({
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea,
    } as never)
    const window = {
      bounds: collapsedAt(900, 400),
      getBounds() {
        return this.bounds
      },
      setBounds(next: { x: number; y: number; width: number; height: number }) {
        this.bounds = { ...next }
      },
      setPosition: vi.fn(),
    }
    setFloatingExpanded(window as never, true)
    moveFloatingBall(window as never, 900, 380)
    expect(window.bounds).toEqual(expandedAt(900, 380, 'left', 'up'))
    expect(window.setPosition).not.toHaveBeenCalled()
  })

  it('moves a collapsed overlay with setBounds around the ball origin', async () => {
    const { screen } = await import('electron')
    vi.mocked(screen.getDisplayNearestPoint).mockReturnValue({
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 0, width: 1440, height: 900 },
    } as never)
    const window = {
      getBounds: () => collapsedAt(400, 300),
      setBounds: vi.fn(),
      setPosition: vi.fn(),
    }
    expect(moveFloatingBall(window as never, 20, 30)).toEqual({ docked: undefined })
    expect(window.setBounds).toHaveBeenCalledWith(collapsedAt(20, 30))
    expect(window.setPosition).not.toHaveBeenCalled()
  })
})

describe('floating window edge dock', () => {
  it('paints a 6x72 gray dock tab and does not use body:not(.expanded) #ball', () => {
    const css = readFileSync(new URL('../renderer/floating.css', import.meta.url), 'utf8')
    expect(css).toContain('#dock-tab')
    expect(css).toContain(`width: ${String(FLOATING_DOCK_TAB_WIDTH)}px`)
    expect(css).toContain(`height: ${String(FLOATING_DOCK_TAB_HEIGHT)}px`)
    expect(css).toContain(FLOATING_DOCK_TAB_FILL)
    expect(css).toContain('dock-tab-breath')
    expect(css).not.toContain('body:not(.expanded) #ball')
  })

  it('docks on contact with a left or right bounds edge within the release tolerance', () => {
    expect(dockSideForBallOrigin({ x: 0, y: 400 }, screenBounds)).toBe('left')
    expect(dockSideForBallOrigin({ x: screenBounds.width - FLOATING_BALL_SIZE, y: 400 }, screenBounds)).toBe('right')
    // The tolerance absorbs a window read-back that lands a pixel or two short of the edge.
    expect(dockSideForBallOrigin({ x: FLOATING_DOCK_OVERLAP, y: 400 }, screenBounds)).toBe('left')
    expect(dockSideForBallOrigin({ x: FLOATING_DOCK_OVERLAP + 1, y: 400 }, screenBounds)).toBeUndefined()
    expect(dockSideForBallOrigin({
      x: screenBounds.width - FLOATING_BALL_SIZE - FLOATING_DOCK_OVERLAP,
      y: 400,
    }, screenBounds)).toBe('right')
    expect(dockSideForBallOrigin({
      x: screenBounds.width - FLOATING_BALL_SIZE - FLOATING_DOCK_OVERLAP - 1,
      y: 400,
    }, screenBounds)).toBeUndefined()
    // A ball dragged past the edge still docks.
    expect(dockSideForBallOrigin({ x: -20, y: 400 }, screenBounds)).toBe('left')
    expect(dockSideForBallOrigin({ x: 400, y: -40 }, screenBounds)).toBeUndefined()
    expect(dockSideForBallOrigin({ x: 400, y: 880 }, screenBounds)).toBeUndefined()
  })

  it('never docks against an edge shared with another display', () => {
    const left = { x: -1440, y: 0, width: 1440, height: 900 }
    const right = { x: screenBounds.width, y: 0, width: 1440, height: 900 }
    expect(dockSideForBallOrigin({ x: 0, y: 400 }, screenBounds, [screenBounds])).toBe('left')
    expect(dockSideForBallOrigin({ x: 0, y: 400 }, screenBounds, [screenBounds, left])).toBeUndefined()
    expect(dockSideForBallOrigin({
      x: screenBounds.width - FLOATING_BALL_SIZE,
      y: 400,
    }, screenBounds, [screenBounds, right])).toBeUndefined()
  })

  it('does not dock the default right-edge origin or a work-area clamp', async () => {
    await mockScreen()
    const origin = defaultFloatingBallOrigin(workArea)
    expect(dockSideForBallOrigin(origin, screenBounds)).toBeUndefined()
    const window = overlayAt(80, 40)
    expect(await clampFloatingWindow(window as never)).toEqual({ docked: undefined })
    expect(window.bounds).toEqual(collapsedAt(100, 50))
  })

  it('snaps on clamp, keeps clamp docked, unsnaps to a 5px inset, and undocks when pulled inward', async () => {
    await mockScreen()
    const window = overlayAt(400, 300)
    const dockX = screenBounds.width - FLOATING_BALL_SIZE + FLOATING_DOCK_OVERLAP
    expect(moveFloatingBall(window as never, dockX, 300)).toEqual({ docked: undefined })
    expect(window.bounds).toEqual(collapsedAt(dockX, 300))
    expect(await clampFloatingWindow(window as never)).toEqual({ docked: 'right' })
    expect(window.bounds).toEqual(dockedTabBounds('right', 300, workArea))
    expect(window.bounds.width).toBe(FLOATING_DOCK_HIT_WIDTH)
    expect(window.bounds.height).toBe(FLOATING_DOCK_HIT_HEIGHT)
    expect(await clampFloatingWindow(window as never)).toEqual({ docked: 'right' })
    expect(window.bounds).toEqual(dockedTabBounds('right', 300, workArea))
    expect(await unsnapDockedBall(window as never)).toEqual({ docked: undefined })
    expect(window.bounds).toEqual(collapsedAt(
      workArea.x + workArea.width - FLOATING_BALL_SIZE - FLOATING_DOCK_IN_PAD,
      300,
    ))
    expect(moveFloatingBall(window as never, dockX, 300)).toEqual({ docked: undefined })
    expect(await clampFloatingWindow(window as never)).toEqual({ docked: 'right' })
    const inwardX = screenBounds.width - FLOATING_DOCK_DRAG_OFF - 1
    expect(moveFloatingBall(window as never, inwardX, 300)).toEqual({ docked: undefined })
    expect(window.bounds).toEqual(collapsedAt(inwardX, 300))
  })

  it('snaps to a left tab on clamp and expanding the panel clears dock', async () => {
    await mockScreen()
    const window = overlayAt(400, 300)
    expect(moveFloatingBall(window as never, -FLOATING_DOCK_OVERLAP, 280)).toEqual({ docked: undefined })
    expect(await clampFloatingWindow(window as never)).toEqual({ docked: 'left' })
    expect(window.bounds).toEqual(dockedTabBounds('left', 280, workArea))
    expect(setFloatingExpanded(window as never, true)).toMatchObject({
      expanded: true,
      docked: undefined,
    })
    expect(window.bounds.width).toBe(FLOATING_PANEL_WINDOW_SIZE.width)
  })

  it('does not dock while canDock is false', async () => {
    await mockScreen()
    const window = overlayAt(400, 300)
    const dockX = screenBounds.width - FLOATING_BALL_SIZE + FLOATING_DOCK_OVERLAP
    expect(moveFloatingBall(window as never, dockX, 300, false)).toEqual({ docked: undefined })
    expect(window.bounds).toEqual(collapsedAt(dockX, 300))
    expect(await clampFloatingWindow(window as never, false)).toEqual({ docked: undefined })
    expect(window.bounds).toEqual(collapsedAt(workArea.x + workArea.width - FLOATING_BALL_SIZE, 300))
  })
})

describe('floating ball drag placement', () => {
  it('records the grab from the OS cursor and places the ball under it', async () => {
    await mockScreen()
    const window = overlayAt(400, 300)
    pressFloatingBall(window as never, { x: 436, y: 336 })
    beginFloatingDrag(window as never)
    expect(dragFloatingBall(window as never, { x: 536, y: 436 })).toEqual({ docked: undefined })
    expect(window.bounds).toEqual(collapsedAt(500, 400))
    const state = await endFloatingDrag(window as never, { x: 536, y: 436 })
    expect(state).toMatchObject({ expanded: false, docked: undefined })
    expect(window.bounds).toEqual(collapsedAt(500, 400))
  })

  it('ignores a move that never passed the press threshold', async () => {
    await mockScreen()
    const window = overlayAt(400, 300)
    pressFloatingBall(window as never, { x: 436, y: 336 })
    expect(dragFloatingBall(window as never, { x: 700, y: 700 })).toEqual({ docked: undefined })
    expect(window.bounds).toEqual(collapsedAt(400, 300))
  })

  it('docks from the requested origin even when the OS read-back falls short of the edge', async () => {
    await mockScreen()
    const window = {
      bounds: collapsedAt(400, 300),
      getBounds() { return this.bounds },
      setBounds(next: { x: number; y: number; width: number; height: number }) {
        // Windows keeps the frame inside the display, so a 5px overhang reads back short.
        this.bounds = { ...next, x: Math.min(next.x, screenBounds.width - next.width) }
      },
    }
    pressFloatingBall(window as never, { x: 436, y: 336 })
    beginFloatingDrag(window as never)
    const cursor = { x: screenBounds.width - FLOATING_BALL_SIZE + 5 + 36, y: 336 }
    dragFloatingBall(window as never, cursor)
    const state = await endFloatingDrag(window as never, cursor)
    expect(state.docked).toBe('right')
    expect(window.bounds).toEqual(dockedTabBounds('right', 300, workArea))
  })

  it('treats a 97px read-back as the collapsed ball instead of an expanded panel', async () => {
    await mockScreen()
    const window = {
      bounds: {
        ...collapsedAt(400, 300),
        width: FLOATING_BALL_WINDOW_SIZE + 1,
        height: FLOATING_BALL_WINDOW_SIZE + 1,
      },
      getBounds() { return this.bounds },
      setBounds(next: { x: number; y: number; width: number; height: number }) {
        this.bounds = { ...next }
      },
    }
    pressFloatingBall(window as never, { x: 436, y: 336 })
    beginFloatingDrag(window as never)
    dragFloatingBall(window as never, { x: 500, y: 400 })
    expect(window.bounds).toEqual(collapsedAt(464, 364))
  })

  it('does not dock a release that is clear of both side edges', async () => {
    await mockScreen()
    const window = overlayAt(400, 300)
    pressFloatingBall(window as never, { x: 436, y: 336 })
    beginFloatingDrag(window as never)
    const state = await endFloatingDrag(window as never, { x: 636, y: 536 })
    expect(state).toMatchObject({ expanded: false, docked: undefined })
    expect(window.bounds).toEqual(collapsedAt(600, 500))
  })
})

describe('floating window context menu', () => {
  const onOpenMain = vi.fn()
  const onQuit = vi.fn()

  it('adds cut, copy, and paste when the target is editable', () => {
    const template = floatingContextMenuTemplate(
      { isEditable: true, editFlags: { canCut: false, canCopy: true, canPaste: true } },
      messages,
      onOpenMain,
      onQuit,
    )
    expect(template).toEqual([
      { role: 'cut', enabled: false },
      { role: 'copy', enabled: true },
      { role: 'paste', enabled: true },
      { type: 'separator' },
      { label: 'Open Main Window', click: onOpenMain },
      { type: 'separator' },
      { label: 'Quit DeepSeek Orb', click: onQuit },
    ])
  })

  it('keeps Open Main and Quit when the target is not editable', () => {
    const template = floatingContextMenuTemplate(
      { isEditable: false, editFlags: { canCut: false, canCopy: false, canPaste: false } },
      messages,
      onOpenMain,
      onQuit,
    )
    expect(template).toEqual([
      { label: 'Open Main Window', click: onOpenMain },
      { type: 'separator' },
      { label: 'Quit DeepSeek Orb', click: onQuit },
    ])
  })

  it('adds enable/disable selection toolbar between Open Main and Quit', () => {
    const onToggle = vi.fn()
    const template = floatingContextMenuTemplate(
      { isEditable: false, editFlags: { canCut: false, canCopy: false, canPaste: false } },
      {
        ...messages,
      },
      onOpenMain,
      onQuit,
      { enabled: true, onToggle },
    )
    expect(template).toEqual([
      { label: 'Open Main Window', click: onOpenMain },
      { type: 'separator' },
      { label: 'Disable Selection Toolbar', click: onToggle },
      { type: 'separator' },
      { label: 'Quit DeepSeek Orb', click: onQuit },
    ])
  })

  it('places millifraction coordinates below the selection toolbar and above Quit', () => {
    const onToggle = vi.fn()
    const onMillifraction = vi.fn()
    const template = floatingContextMenuTemplate(
      { isEditable: false, editFlags: { canCut: false, canCopy: false, canPaste: false } },
      messages,
      onOpenMain,
      onQuit,
      { enabled: true, onToggle },
      undefined,
      { enabled: false, onToggle: onMillifraction },
    )
    expect(template).toEqual([
      { label: 'Open Main Window', click: onOpenMain },
      { type: 'separator' },
      { label: 'Disable Selection Toolbar', click: onToggle },
      { label: 'Enable millifraction coordinates', click: onMillifraction },
      { type: 'separator' },
      { label: 'Quit DeepSeek Orb', click: onQuit },
    ])
  })

  it('inserts overlay and background model submenus before the selection toolbar', () => {
    const onSelectOverlay = vi.fn()
    const onSelectBackground = vi.fn()
    const onToggle = vi.fn()
    const onMillifraction = vi.fn()
    const template = floatingContextMenuTemplate(
      { isEditable: false, editFlags: { canCut: false, canCopy: false, canPaste: false } },
      messages,
      onOpenMain,
      onQuit,
      { enabled: false, onToggle },
      {
        catalog: {
          groups: [{
            id: 'deepseek-official',
            name: 'DeepSeek',
            models: [{
              id: 'deepseek-flash',
              name: 'DeepSeek-V41-Flash',
              reasoning: {
                efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
                defaultEffort: 'high',
              },
            }, {
              id: 'deepseek-chat',
              name: 'DeepSeek-V41',
              reasoning: {
                efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
                defaultEffort: 'high',
              },
            }],
          }],
        },
        overlay: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' },
        background: { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' },
        onSelectOverlay,
        onSelectBackground,
      },
      { enabled: true, onToggle: onMillifraction },
    )
    expect(template.map(item => item.label ?? item.type)).toEqual([
      'Open Main Window',
      'separator',
      'Floating Agent Settings',
      'Background Agent Settings',
      'separator',
      'Enable Selection Toolbar',
      'Disable millifraction coordinates',
      'separator',
      'Quit DeepSeek Orb',
    ])
    const overlay = template[2]
    expect(overlay?.submenu).toEqual([
      { label: 'DeepSeek', enabled: false },
      {
        label: '✓ DeepSeek-V41-Flash',
        submenu: [
          { label: 'High', type: 'radio', checked: false, click: expect.any(Function) },
          { label: 'Max', type: 'radio', checked: true, click: expect.any(Function) },
        ],
      },
      {
        label: 'DeepSeek-V41',
        submenu: [
          { label: 'High', type: 'radio', checked: false, click: expect.any(Function) },
          { label: 'Max', type: 'radio', checked: false, click: expect.any(Function) },
        ],
      },
    ])
    const background = template[3]
    expect(background?.submenu).toEqual([
      { label: 'DeepSeek', enabled: false },
      {
        label: 'DeepSeek-V41-Flash',
        submenu: [
          { label: 'High', type: 'radio', checked: false, click: expect.any(Function) },
          { label: 'Max', type: 'radio', checked: false, click: expect.any(Function) },
        ],
      },
      {
        label: '✓ DeepSeek-V41',
        submenu: [
          { label: 'High', type: 'radio', checked: true, click: expect.any(Function) },
          { label: 'Max', type: 'radio', checked: false, click: expect.any(Function) },
        ],
      },
    ])
  })
})

describe('floating overlay guard', () => {
  function overlayWindow() {
    return {
      destroyed: false,
      contentProtection: false,
      ignoreMouseEvents: false,
      ignoreMouseEventsForward: undefined as boolean | undefined,
      isDestroyed() { return this.destroyed },
      setContentProtection(value: boolean) { this.contentProtection = value },
      setIgnoreMouseEvents(value: boolean, options?: { forward?: boolean }) {
        this.ignoreMouseEvents = value
        this.ignoreMouseEventsForward = options?.forward
      },
      blur: vi.fn(),
    }
  }

  it('sets contentProtection on Windows during capture; HID stays click-through', () => {
    const window = overlayWindow()
    applyFloatingOverlayGuard(window as never, 'capture', 'begin')
    expect(window.contentProtection).toBe(process.platform === 'win32')
    expect(window.ignoreMouseEvents).toBe(false)
    applyFloatingOverlayGuard(window as never, 'capture', 'end')
    expect(window.contentProtection).toBe(false)
  })

  it('makes the overlay click-through only while input is held', () => {
    const window = overlayWindow()
    applyFloatingOverlayGuard(window as never, 'input', 'begin')
    expect(window.ignoreMouseEvents).toBe(true)
    expect(window.ignoreMouseEventsForward).toBe(false)
    expect(window.blur).toHaveBeenCalled()
    expect(window.contentProtection).toBe(process.platform === 'win32')
    applyFloatingOverlayGuard(window as never, 'input', 'end')
    expect(window.ignoreMouseEvents).toBe(false)
  })

  it('keeps click-through while a nested input begin is still open', () => {
    const window = overlayWindow()
    applyFloatingOverlayGuard(window as never, 'input', 'begin')
    applyFloatingOverlayGuard(window as never, 'input', 'begin')
    applyFloatingOverlayGuard(window as never, 'input', 'end')
    expect(window.ignoreMouseEvents).toBe(true)
    applyFloatingOverlayGuard(window as never, 'input', 'end')
    expect(window.ignoreMouseEvents).toBe(false)
  })

  it('does not blur again for nested capture while input is held', () => {
    const window = overlayWindow()
    applyFloatingOverlayGuard(window as never, 'input', 'begin')
    expect(window.blur).toHaveBeenCalledTimes(1)
    applyFloatingOverlayGuard(window as never, 'capture', 'begin')
    applyFloatingOverlayGuard(window as never, 'input', 'begin')
    applyFloatingOverlayGuard(window as never, 'capture', 'end')
    applyFloatingOverlayGuard(window as never, 'input', 'end')
    expect(window.blur).toHaveBeenCalledTimes(1)
    expect(window.ignoreMouseEvents).toBe(true)
    applyFloatingOverlayGuard(window as never, 'input', 'end')
    expect(window.ignoreMouseEvents).toBe(false)
  })

  it('resets both modes so Host exit cannot leave the overlay cloaked', () => {
    const window = overlayWindow()
    applyFloatingOverlayGuard(window as never, 'capture', 'begin')
    applyFloatingOverlayGuard(window as never, 'input', 'begin')
    resetFloatingOverlayGuard(window as never)
    expect(window.contentProtection).toBe(false)
    expect(window.ignoreMouseEvents).toBe(false)
  })

  it('parses overlay CGWindowIDs from desktopCapturer source ids', () => {
    expect(cgWindowIdFromMediaSourceId('window:4242:0')).toBe(4242)
    expect(() => cgWindowIdFromMediaSourceId('screen:1:0')).toThrow(/not a CGWindowID/u)
    const window = {
      destroyed: false,
      visible: true,
      isDestroyed() { return this.destroyed },
      isVisible() { return this.visible },
      getMediaSourceId() { return 'window:77:0' },
    }
    expect(overlayWindowExcludeIds(window as never)).toEqual([77])
    window.destroyed = true
    expect(overlayWindowExcludeIds(window as never)).toEqual([])
    const ball = {
      destroyed: false,
      visible: true,
      isDestroyed() { return this.destroyed },
      isVisible() { return this.visible },
      getMediaSourceId() { return 'window:11:0' },
    }
    const toolbar = {
      destroyed: false,
      visible: false,
      isDestroyed() { return this.destroyed },
      isVisible() { return this.visible },
      getMediaSourceId() { return 'window:22:0' },
    }
    expect(overlayWindowExcludeIds(ball as never, toolbar as never)).toEqual([11])
    toolbar.visible = true
    expect(overlayWindowExcludeIds(ball as never, toolbar as never)).toEqual([11, 22])
    expect(overlayWindowExcludeIds(ball as never, undefined)).toEqual([11])
  })
})
