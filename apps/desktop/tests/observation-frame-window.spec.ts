import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const { FakeBrowserWindow } = vi.hoisted(() => {
  class FakeBrowserWindow {
    ignoreMouseEvents = false
    ignoreMouseEventsForward: boolean | undefined
    alwaysOnTopLevel: string | undefined
    alwaysOnTopRelativeLevel: number | undefined
    setIgnoreMouseEvents(value: boolean, options?: { forward?: boolean }) {
      this.ignoreMouseEvents = value
      this.ignoreMouseEventsForward = options?.forward
    }
    setAlwaysOnTop(_flag: boolean, level?: string, relativeLevel?: number) {
      this.alwaysOnTopLevel = level
      this.alwaysOnTopRelativeLevel = relativeLevel
    }
    setVisibleOnAllWorkspaces() {}
    moveTop() {}
    webContents = { setWindowOpenHandler() {} }
  }
  return { FakeBrowserWindow }
})

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  screen: { getDisplayNearestPoint: vi.fn() },
}))

import {
  createObservationFrameWindow,
  FLOATING_OVERLAY_ALWAYS_ON_TOP_RELATIVE,
  OBSERVATION_FRAME_ALWAYS_ON_TOP_RELATIVE,
  OBSERVATION_FRAME_GLOW_PX,
  OBSERVATION_FRAME_OUTSET,
  OBSERVATION_FRAME_STROKE_PX,
  OVERLAY_ALWAYS_ON_TOP_LEVEL,
  observationFrameBounds,
  raiseOverlayAboveObservationFrame,
} from '../src/observation-frame-window.ts'

describe('observation frame geometry', () => {
  const workArea = { x: 100, y: 50, width: 1000, height: 800 }

  it('inflates the observation rectangle by the outset', () => {
    expect(observationFrameBounds(
      { x: 200, y: 120, width: 400, height: 300 },
      workArea,
    )).toEqual({
      x: 200 - OBSERVATION_FRAME_OUTSET,
      y: 120 - OBSERVATION_FRAME_OUTSET,
      width: 400 + OBSERVATION_FRAME_OUTSET * 2,
      height: 300 + OBSERVATION_FRAME_OUTSET * 2,
    })
  })

  it('clamps an inflated rectangle that would leave the work area', () => {
    expect(observationFrameBounds(
      { x: 100, y: 50, width: 1000, height: 800 },
      workArea,
    )).toEqual(workArea)
    expect(observationFrameBounds(
      { x: 2000, y: 2000, width: 40, height: 40 },
      workArea,
    )).toEqual({
      x: 1099,
      y: 849,
      width: 1,
      height: 1,
    })
  })

  it('keeps renderer CSS stroke equal to OBSERVATION_FRAME_STROKE_PX and forbids animation', () => {
    const css = readFileSync(new URL('../renderer/observation-frame.css', import.meta.url), 'utf8')
    expect(css).toContain(`padding: ${String(OBSERVATION_FRAME_GLOW_PX)}px`)
    expect(css).toContain(`padding: ${String(OBSERVATION_FRAME_STROKE_PX)}px`)
    expect(css).toMatch(/drop-shadow/u)
    expect(css).not.toMatch(/animation/iu)
    expect(css).not.toMatch(/@keyframes/u)
  })

  it('always click-throughs with forwarded mouse events below the floating overlay', () => {
    const window = createObservationFrameWindow() as unknown as InstanceType<typeof FakeBrowserWindow>
    expect(window.ignoreMouseEvents).toBe(true)
    expect(window.ignoreMouseEventsForward).toBe(true)
    expect(window.alwaysOnTopLevel).toBe(OVERLAY_ALWAYS_ON_TOP_LEVEL)
    expect(window.alwaysOnTopRelativeLevel).toBe(OBSERVATION_FRAME_ALWAYS_ON_TOP_RELATIVE)
    expect(OBSERVATION_FRAME_ALWAYS_ON_TOP_RELATIVE).toBeLessThan(FLOATING_OVERLAY_ALWAYS_ON_TOP_RELATIVE)
  })

  it('raises the floating overlay above the ribbon', () => {
    const overlay = {
      destroyed: false,
      isDestroyed() { return this.destroyed },
      setAlwaysOnTop: vi.fn(),
      moveTop: vi.fn(),
    }
    const hiddenToolbar = {
      destroyed: false,
      visible: false,
      isDestroyed() { return this.destroyed },
      isVisible() { return this.visible },
      setAlwaysOnTop: vi.fn(),
      moveTop: vi.fn(),
    }
    raiseOverlayAboveObservationFrame(overlay as never, hiddenToolbar as never)
    expect(overlay.setAlwaysOnTop).toHaveBeenCalledWith(
      true,
      OVERLAY_ALWAYS_ON_TOP_LEVEL,
      FLOATING_OVERLAY_ALWAYS_ON_TOP_RELATIVE,
    )
    expect(overlay.moveTop).toHaveBeenCalledTimes(1)
    expect(hiddenToolbar.moveTop).not.toHaveBeenCalled()
    hiddenToolbar.visible = true
    raiseOverlayAboveObservationFrame(overlay as never, hiddenToolbar as never)
    expect(hiddenToolbar.moveTop).toHaveBeenCalledTimes(1)
  })
})
