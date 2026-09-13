import { describe, expect, it } from 'vitest'
import {
  assertAllowedHotkey,
  COORDINATE_SPACE,
  isForbiddenScreenshotHotkey,
  mapNormalizedToGlobal,
  requireNormalizedPosition,
} from '../src/coordinates.ts'
import type { ScreenInfo } from '../src/backend.ts'

const screen: ScreenInfo = {
  index: 0,
  bounds: { x: 100, y: 50, width: 1000, height: 500 },
  scale: 2,
}

describe('normalized coordinates', () => {
  it('maps the 0–1000 corners onto the screen bounds', () => {
    expect(mapNormalizedToGlobal([0, 0], screen)).toEqual({ x: 100, y: 50 })
    expect(mapNormalizedToGlobal([COORDINATE_SPACE, COORDINATE_SPACE], screen)).toEqual({ x: 1100, y: 550 })
    expect(mapNormalizedToGlobal([500, 250], screen)).toEqual({ x: 600, y: 175 })
  })

  it('rejects positions that are not two finite 0–1000 numbers', () => {
    expect(() => requireNormalizedPosition([0])).toThrow(/exactly two coordinates/u)
    expect(() => requireNormalizedPosition([0, 1, 2])).toThrow(/exactly two coordinates/u)
    expect(() => requireNormalizedPosition([Number.NaN, 0])).toThrow(/finite numbers/u)
    expect(() => requireNormalizedPosition([-1, 0])).toThrow(/0–1000/u)
    expect(() => requireNormalizedPosition([0, 1001])).toThrow(/0–1000/u)
    expect(requireNormalizedPosition([0, 1000])).toEqual([0, 1000])
  })
})

describe('screenshot hotkeys', () => {
  it('rejects Cmd/Win+Shift+3/4/5 in any token case', () => {
    expect(isForbiddenScreenshotHotkey(['cmd', 'shift', '3'])).toBe(true)
    expect(isForbiddenScreenshotHotkey(['Command', 'Shift', '4'])).toBe(true)
    expect(isForbiddenScreenshotHotkey(['win', 'shift', '5'])).toBe(true)
    expect(isForbiddenScreenshotHotkey(['meta', 'SHIFT', '3'])).toBe(true)
    expect(() => {
      assertAllowedHotkey(['super', 'shift', '4'])
    }).toThrow(/screenshot shortcuts are forbidden/u)
  })

  it('allows ordinary chords', () => {
    expect(isForbiddenScreenshotHotkey(['cmd', 'c'])).toBe(false)
    expect(isForbiddenScreenshotHotkey(['cmd', 'shift', 's'])).toBe(false)
    expect(isForbiddenScreenshotHotkey(['shift', '3'])).toBe(false)
    expect(isForbiddenScreenshotHotkey(['cmd', '3'])).toBe(false)
    assertAllowedHotkey(['ctrl', 'c'])
  })
})
