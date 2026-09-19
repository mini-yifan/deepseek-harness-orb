import { readFileSync } from 'node:fs'
import { screen } from 'electron'
import { describe, expect, it, vi } from 'vitest'

const { FakeBrowserWindow } = vi.hoisted(() => {
  class FakeBrowserWindow {
    ignoreMouseEvents = false
    ignoreMouseEventsForward: boolean | undefined
    alwaysOnTopLevel: string | undefined
    alwaysOnTopRelativeLevel: number | undefined
    destroyed = false
    loading = false
    contentBounds = { x: 0, y: 0, width: 1, height: 1 }
    readonly loadHandlers: Array<() => void> = []
    readonly options: { roundedCorners?: boolean }
    constructor(options: { roundedCorners?: boolean } = {}) {
      this.options = options
    }
    isDestroyed() { return this.destroyed }
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
    showInactive() {}
    setContentBounds(next: { x: number; y: number; width: number; height: number }) {
      this.contentBounds = { ...next }
    }
    getContentBounds() { return { ...this.contentBounds } }
    webContents = {
      setWindowOpenHandler() {},
      isLoading: () => this.loading,
      executeJavaScript: vi.fn(async () => undefined),
      once: (event: string, handler: () => void) => {
        if (event === 'did-finish-load') this.loadHandlers.push(handler)
      },
    }
    finishLoad() {
      const handlers = this.loadHandlers.splice(0)
      for (const handler of handlers) handler()
    }
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
  observationFramePadding,
  observationFramePlacement,
  raiseOverlayAboveObservationFrame,
  showObservationFrame,
  type ObservationFramePlacement,
} from '../src/observation-frame-window.ts'

const workArea = { x: 100, y: 50, width: 1000, height: 800 }
const unclippedGlow = {
  top: OBSERVATION_FRAME_GLOW_PX,
  right: OBSERVATION_FRAME_GLOW_PX,
  bottom: OBSERVATION_FRAME_GLOW_PX,
  left: OBSERVATION_FRAME_GLOW_PX,
}
const alwaysStroke = {
  top: OBSERVATION_FRAME_STROKE_PX,
  right: OBSERVATION_FRAME_STROKE_PX,
  bottom: OBSERVATION_FRAME_STROKE_PX,
  left: OBSERVATION_FRAME_STROKE_PX,
}

function innerHole(placement: ObservationFramePlacement) {
  return {
    x: placement.bounds.x + placement.glow.left + placement.stroke.left,
    y: placement.bounds.y + placement.glow.top + placement.stroke.top,
    width: placement.bounds.width
      - placement.glow.left - placement.stroke.left
      - placement.glow.right - placement.stroke.right,
    height: placement.bounds.height
      - placement.glow.top - placement.stroke.top
      - placement.glow.bottom - placement.stroke.bottom,
  }
}

describe('observation frame geometry', () => {
  it('inflates the observation rectangle by the outset', () => {
    const region = { x: 200, y: 120, width: 400, height: 300 }
    const placement = observationFramePlacement(region, workArea)
    expect(placement.bounds).toEqual({
      x: 200 - OBSERVATION_FRAME_OUTSET,
      y: 120 - OBSERVATION_FRAME_OUTSET,
      width: 400 + OBSERVATION_FRAME_OUTSET * 2,
      height: 300 + OBSERVATION_FRAME_OUTSET * 2,
    })
    expect(placement.glow).toEqual(unclippedGlow)
    expect(placement.stroke).toEqual(alwaysStroke)
    expect(innerHole(placement)).toEqual(region)
  })

  it('clips a top-flush inflated rectangle without translating it', () => {
    const region = { x: 200, y: 50, width: 400, height: 300 }
    const placement = observationFramePlacement(region, workArea)
    expect(placement.bounds).toEqual({
      x: 200 - OBSERVATION_FRAME_OUTSET,
      y: 50,
      width: 400 + OBSERVATION_FRAME_OUTSET * 2,
      height: 300 + OBSERVATION_FRAME_OUTSET,
    })
    expect(placement.glow).toEqual({ ...unclippedGlow, top: 0 })
    expect(placement.stroke).toEqual(alwaysStroke)
    expect(innerHole(placement)).toEqual({
      x: region.x,
      y: region.y + OBSERVATION_FRAME_STROKE_PX,
      width: region.width,
      height: region.height - OBSERVATION_FRAME_STROKE_PX,
    })
  })

  it('clips a left-flush inflated rectangle without translating it', () => {
    const region = { x: 100, y: 120, width: 400, height: 300 }
    const placement = observationFramePlacement(region, workArea)
    expect(placement.bounds).toEqual({
      x: 100,
      y: 120 - OBSERVATION_FRAME_OUTSET,
      width: 400 + OBSERVATION_FRAME_OUTSET,
      height: 300 + OBSERVATION_FRAME_OUTSET * 2,
    })
    expect(placement.glow).toEqual({ ...unclippedGlow, left: 0 })
    expect(placement.stroke).toEqual(alwaysStroke)
    expect(innerHole(placement)).toEqual({
      x: region.x + OBSERVATION_FRAME_STROKE_PX,
      y: region.y,
      width: region.width - OBSERVATION_FRAME_STROKE_PX,
      height: region.height,
    })
  })

  it('keeps the inner hole 4px inside a work-area-filling observation', () => {
    const placement = observationFramePlacement(workArea, workArea)
    expect(placement.bounds).toEqual(workArea)
    expect(placement.glow).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(placement.stroke).toEqual(alwaysStroke)
    expect(innerHole(placement)).toEqual({
      x: workArea.x + OBSERVATION_FRAME_STROKE_PX,
      y: workArea.y + OBSERVATION_FRAME_STROKE_PX,
      width: workArea.width - OBSERVATION_FRAME_STROKE_PX * 2,
      height: workArea.height - OBSERVATION_FRAME_STROKE_PX * 2,
    })
  })

  it('places a 1×1 window when the observation does not intersect the work area', () => {
    expect(observationFramePlacement(
      { x: 2000, y: 2000, width: 40, height: 40 },
      workArea,
    ).bounds).toEqual({
      x: 1099,
      y: 849,
      width: 1,
      height: 1,
    })
  })

  it('recomputes padding from an actual content rectangle', () => {
    const region = { x: 200, y: 120, width: 400, height: 300 }
    const placement = observationFramePlacement(region, workArea)
    expect(observationFramePadding(region, placement.bounds)).toEqual({
      glow: placement.glow,
      stroke: placement.stroke,
    })
    expect(observationFramePadding(region, {
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    })).toEqual({
      glow: { top: 0, right: 0, bottom: 0, left: 0 },
      stroke: alwaysStroke,
    })
  })

  it('keeps renderer CSS stroke equal to OBSERVATION_FRAME_STROKE_PX and forbids animation', () => {
    const css = readFileSync(new URL('../renderer/observation-frame.css', import.meta.url), 'utf8')
    expect(css).toContain(`var(--glow-top, ${String(OBSERVATION_FRAME_GLOW_PX)}px)`)
    expect(css).toContain(`var(--stroke-top, ${String(OBSERVATION_FRAME_STROKE_PX)}px)`)
    expect(css).toMatch(/drop-shadow/u)
    expect(css).not.toMatch(/animation/iu)
    expect(css).not.toMatch(/@keyframes/u)
  })

  it('always click-throughs with forwarded mouse events below the floating overlay', () => {
    const window = createObservationFrameWindow() as unknown as InstanceType<typeof FakeBrowserWindow>
    expect(window.options.roundedCorners).toBe(false)
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

  it('applies content bounds and CSS variables when showing the ribbon', () => {
    vi.mocked(screen.getDisplayNearestPoint).mockReturnValue({ workArea } as never)
    const region = { x: 200, y: 120, width: 400, height: 300 }
    const placement = observationFramePlacement(region, workArea)
    const window = createObservationFrameWindow() as unknown as InstanceType<typeof FakeBrowserWindow>
    showObservationFrame(window as never, region)
    expect(window.contentBounds).toEqual(placement.bounds)
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"--glow-top", "12px"'),
    )
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"--stroke-left", "4px"'),
    )
  })

  it('recomputes CSS padding from the content rectangle WindowServer actually granted', () => {
    vi.mocked(screen.getDisplayNearestPoint).mockReturnValue({ workArea } as never)
    const region = { x: 200, y: 120, width: 400, height: 300 }
    const window = createObservationFrameWindow() as unknown as InstanceType<typeof FakeBrowserWindow>
    window.getContentBounds = () => ({ x: region.x, y: region.y, width: region.width, height: region.height })
    showObservationFrame(window as never, region)
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"--glow-top", "0px"'),
    )
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"--stroke-top", "4px"'),
    )
  })

  it('applies the latest CSS padding after the frame document finishes loading', () => {
    vi.mocked(screen.getDisplayNearestPoint).mockReturnValue({ workArea } as never)
    const first = { x: 200, y: 120, width: 400, height: 300 }
    const second = { x: 100, y: 50, width: 1000, height: 800 }
    const window = createObservationFrameWindow() as unknown as InstanceType<typeof FakeBrowserWindow>
    window.loading = true
    showObservationFrame(window as never, first)
    showObservationFrame(window as never, second)
    expect(window.webContents.executeJavaScript).not.toHaveBeenCalled()
    window.loading = false
    window.finishLoad()
    expect(window.webContents.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"--glow-top", "0px"'),
    )
  })
})
