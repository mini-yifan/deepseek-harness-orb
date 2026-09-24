import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class FakeBrowserWindow { readonly kind = 'window' },
  screen: { getDisplayNearestPoint: vi.fn() },
}))

import {
  pointInWindow,
  SELECTION_TOOLBAR_SIZE,
  selectionToolbarBounds,
  selectionToolbarMenuBounds,
} from '../src/selection-toolbar-window.ts'

describe('selection toolbar geometry', () => {
  const workArea = { x: 100, y: 50, width: 1000, height: 800 }

  it('places the toolbar below the mouse-up point and clamps to the work area', () => {
    expect(selectionToolbarBounds(
      { x: 200, y: 100 },
      SELECTION_TOOLBAR_SIZE,
      workArea,
    )).toEqual({
      x: 200,
      y: 108,
      width: SELECTION_TOOLBAR_SIZE.width,
      height: SELECTION_TOOLBAR_SIZE.height,
    })
    expect(selectionToolbarBounds(
      { x: 2000, y: 2000 },
      { width: 280, height: 46 },
      workArea,
    )).toEqual({
      x: 820,
      y: 804,
      width: 280,
      height: 46,
    })
  })

  it('hit-tests a visible window', () => {
    const window = {
      destroyed: false,
      visible: true,
      bounds: { x: 10, y: 20, width: 100, height: 40 },
      isDestroyed() { return this.destroyed },
      isVisible() { return this.visible },
      getBounds() { return this.bounds },
    }
    expect(pointInWindow(window as never, { x: 10, y: 20 })).toBe(true)
    expect(pointInWindow(window as never, { x: 110, y: 20 })).toBe(false)
    window.visible = false
    expect(pointInWindow(window as never, { x: 10, y: 20 })).toBe(false)
  })

  it('grows the language menu down, or up when the work area would clip it', () => {
    const origin = { x: 180, y: 100 }
    expect(selectionToolbarMenuBounds(origin, { width: 280, height: 120 }, workArea)).toEqual({
      x: 180,
      y: 100,
      width: 280,
      height: 120,
    })
    const short = { x: 0, y: 0, width: 1000, height: 200 }
    expect(selectionToolbarMenuBounds(origin, { width: 280, height: 120 }, short)).toEqual({
      x: 180,
      y: 26,
      width: 280,
      height: 120,
    })
  })
})
