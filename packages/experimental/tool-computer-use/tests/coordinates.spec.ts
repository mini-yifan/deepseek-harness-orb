import { describe, expect, it } from 'vitest'
import {
  assertAllowedHotkey,
  COORDINATE_SPACE,
  isForbiddenScreenshotHotkey,
  mapFractionToGlobal,
  mapNormalizedToGlobal,
  mapPixelToGlobal,
  modelPositionToHid,
  requireClickModifiers,
  requireNormalizedPosition,
  requirePixelPosition,
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

  it('maps fractions through mapFractionToGlobal', () => {
    expect(mapFractionToGlobal([0, 0], screen)).toEqual({ x: 100, y: 50 })
    expect(mapFractionToGlobal([1, 1], screen)).toEqual({ x: 1100, y: 550 })
    expect(mapFractionToGlobal([0.5, 0.5], screen)).toEqual({ x: 600, y: 300 })
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

describe('pixel coordinates', () => {
  const attached = { width: 1470, height: 800 }

  it('maps attached pixels onto the same window fraction as millifraction', () => {
    expect(mapPixelToGlobal([0, 0], attached, screen)).toEqual({ x: 100, y: 50 })
    expect(mapPixelToGlobal([1470, 800], attached, screen)).toEqual({ x: 1100, y: 550 })
    expect(mapPixelToGlobal([754, 155], attached, screen)).toEqual({
      x: 100 + (754 / 1470) * 1000,
      y: 50 + (155 / 800) * 500,
    })
  })

  it('converts pixels to HID millifraction by attached size', () => {
    expect(modelPositionToHid([754, 155], 'pixel', attached)).toEqual([
      (754 / 1470) * COORDINATE_SPACE,
      (155 / 800) * COORDINATE_SPACE,
    ])
    expect(modelPositionToHid([500, 250], 'millifraction', undefined)).toEqual([500, 250])
  })

  it('rejects pixel positions outside the attached raster and fails without a raster', () => {
    expect(() => requirePixelPosition([0], attached)).toThrow(/1470x800/u)
    expect(() => requirePixelPosition([-1, 0], attached)).toThrow(/1470x800/u)
    expect(() => requirePixelPosition([1471, 0], attached)).toThrow(/1470x800/u)
    expect(() => requirePixelPosition([0, 801], attached)).toThrow(/1470x800/u)
    expect(requirePixelPosition([1470, 800], attached)).toEqual([1470, 800])
    expect(() => modelPositionToHid([0, 0], 'pixel', undefined))
      .toThrow(/attached screenshot raster/u)
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

describe('click modifiers', () => {
  it('accepts shift, cmd, option, and control aliases and omits empty lists', () => {
    expect(requireClickModifiers(undefined)).toBeUndefined()
    expect(requireClickModifiers([])).toBeUndefined()
    expect(requireClickModifiers(['shift'])).toEqual(['shift'])
    expect(requireClickModifiers(['Command', 'alt'])).toEqual(['command', 'alt'])
    expect(requireClickModifiers(['win', 'ctrl'])).toEqual(['win', 'ctrl'])
    expect(requireClickModifiers(['cmd', 'command', 'meta'])).toEqual(['cmd'])
  })

  it('rejects letters, fn, and empty tokens', () => {
    expect(() => requireClickModifiers(['a'])).toThrow(/click modifiers must be shift, cmd, option, or control/u)
    expect(() => requireClickModifiers(['fn'])).toThrow(/got "fn"/u)
    expect(() => requireClickModifiers([''])).toThrow(/got ""/u)
  })
})
