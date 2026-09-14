import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class FakeBrowserWindow { readonly kind = 'window' },
  Menu: { buildFromTemplate: vi.fn() },
  screen: { getDisplayNearestPoint: vi.fn() },
}))

import {
  ballOriginFromWindow,
  clampFloatingWindow,
  clampedBallOrigin,
  expandDirection,
  expandedOverlayBounds,
  floatingContextMenuTemplate,
  FLOATING_BALL_SIZE,
  FLOATING_PANEL_SIZE,
  setFloatingExpanded,
} from '../src/floating-window.ts'

const workArea = { x: 100, y: 50, width: 1000, height: 800 }
const messages = { floatingOpenMain: 'Open Main Window', floatingQuit: 'Quit DeepSeek Harness' }

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
})
