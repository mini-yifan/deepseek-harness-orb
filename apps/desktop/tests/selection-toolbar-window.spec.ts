import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class FakeBrowserWindow { readonly kind = 'window' },
  screen: { getDisplayNearestPoint: vi.fn() },
}))

import {
  pointInWindow,
  SELECTION_TOOLBAR_SIZE,
  selectionToolbarBounds,
} from '../src/selection-toolbar-window.ts'

describe('selection toolbar geometry', () => {
  const workArea = { x: 100, y: 50, width: 1000, height: 800 }

  it('places the toolbar below a selection rect and clamps to the work area', () => {
    expect(selectionToolbarBounds(
      { x: 200, y: 100 },
      { x: 180, y: 80, width: 40, height: 20 },
      SELECTION_TOOLBAR_SIZE,
      workArea,
    )).toEqual({
      x: 180,
      y: 108,
      width: SELECTION_TOOLBAR_SIZE.width,
      height: SELECTION_TOOLBAR_SIZE.height,
    })
    expect(selectionToolbarBounds(
      { x: 2000, y: 2000 },
      undefined,
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
})
