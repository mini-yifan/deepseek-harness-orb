import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class FakeBrowserWindow { readonly kind = 'window' },
  Menu: { buildFromTemplate: vi.fn() },
  screen: { getDisplayNearestPoint: vi.fn() },
}))

import {
  applyFloatingOverlayGuard,
  ballOriginFromWindow,
  cgWindowIdFromMediaSourceId,
  clampFloatingWindow,
  clampedBallOrigin,
  expandDirection,
  expandedOverlayBounds,
  floatingContextMenuTemplate,
  FLOATING_BALL_SIZE,
  FLOATING_PANEL_SIZE,
  moveFloatingBall,
  overlayWindowExcludeIds,
  resetFloatingOverlayGuard,
  setFloatingExpanded,
} from '../src/floating-window.ts'

const workArea = { x: 100, y: 50, width: 1000, height: 800 }
const messages = {
  floatingOpenMain: 'Open Main Window',
  floatingQuit: 'Quit DeepSeek Harness',
  selectionToolbarEnable: 'Enable Selection Toolbar',
  selectionToolbarDisable: 'Disable Selection Toolbar',
}

describe('floating window expand geometry', () => {
  it('grows left and up when the ball sits on the right and has space above', () => {
    expect(expandDirection({ x: 900, y: 400 }, workArea)).toEqual({ horizontal: 'left', vertical: 'up' })
    expect(expandedOverlayBounds({ x: 900, y: 400 }, workArea)).toEqual({
      x: 900 - (FLOATING_PANEL_SIZE.width - FLOATING_BALL_SIZE),
      y: 400 - (FLOATING_PANEL_SIZE.height - FLOATING_BALL_SIZE),
      width: FLOATING_PANEL_SIZE.width,
      height: FLOATING_PANEL_SIZE.height,
      horizontal: 'left',
      vertical: 'up',
    })
  })

  it('grows right and down when the ball is near the top-left', () => {
    expect(expandDirection({ x: 120, y: 60 }, workArea)).toEqual({ horizontal: 'right', vertical: 'down' })
    expect(expandedOverlayBounds({ x: 120, y: 60 }, workArea)).toMatchObject({
      x: 120,
      y: 60,
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

  it('resizes the overlay while keeping the ball origin and clamps without edge snap', async () => {
    const { screen } = await import('electron')
    vi.mocked(screen.getDisplayNearestPoint).mockReturnValue({ workArea } as never)
    const window = {
      getBounds: vi.fn(() => ({ x: 900, y: 400, width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE })),
      setBounds: vi.fn(),
      setPosition: vi.fn(),
    }
    expect(setFloatingExpanded(window as never, true)).toEqual({
      expanded: true,
      horizontal: 'left',
      vertical: 'up',
    })
    expect(window.setBounds).toHaveBeenCalledWith({
      x: 900 - (FLOATING_PANEL_SIZE.width - FLOATING_BALL_SIZE),
      y: 400 - (FLOATING_PANEL_SIZE.height - FLOATING_BALL_SIZE),
      width: FLOATING_PANEL_SIZE.width,
      height: FLOATING_PANEL_SIZE.height,
    })
    window.getBounds.mockReturnValue({
      x: 80,
      y: 40,
      width: FLOATING_BALL_SIZE,
      height: FLOATING_BALL_SIZE,
    })
    clampFloatingWindow(window as never)
    expect(window.setPosition).toHaveBeenCalledWith(100, 50)
  })

  it('moves an expanded overlay by ball origin without clamping the panel', async () => {
    const { screen } = await import('electron')
    vi.mocked(screen.getDisplayNearestPoint).mockReturnValue({ workArea } as never)
    const window = {
      bounds: { x: 900, y: 400, width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE },
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
    expect(window.bounds).toEqual({
      x: 900 - (FLOATING_PANEL_SIZE.width - FLOATING_BALL_SIZE),
      y: 380 - (FLOATING_PANEL_SIZE.height - FLOATING_BALL_SIZE),
      width: FLOATING_PANEL_SIZE.width,
      height: FLOATING_PANEL_SIZE.height,
    })
    expect(window.setPosition).not.toHaveBeenCalled()
  })

  it('moves a collapsed overlay with setPosition', async () => {
    const window = {
      getBounds: () => ({ x: 400, y: 300, width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE }),
      setBounds: vi.fn(),
      setPosition: vi.fn(),
    }
    moveFloatingBall(window as never, 20, 30)
    expect(window.setPosition).toHaveBeenCalledWith(20, 30)
    expect(window.setBounds).not.toHaveBeenCalled()
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
      { label: 'Quit DeepSeek Harness', click: onQuit },
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
      { label: 'Quit DeepSeek Harness', click: onQuit },
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
      { label: 'Quit DeepSeek Harness', click: onQuit },
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

  it('does not set contentProtection during capture; HID still click-through', () => {
    const window = overlayWindow()
    applyFloatingOverlayGuard(window as never, 'capture', 'begin')
    expect(window.contentProtection).toBe(false)
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
    expect(window.contentProtection).toBe(false)
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
