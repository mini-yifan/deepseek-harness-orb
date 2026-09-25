import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  clearOrbCoordinateMode,
  DEFAULT_ORB_COORDINATE_MODE,
  isOrbCoordinateMode,
  name,
  setOrbCoordinateMode,
} from '../src/computer-use-orb-coordinate-mode.ts'

afterEach(() => {
  clearOrbCoordinateMode()
})

describe('computer-use-orb-coordinate-mode plugin', () => {
  it('exports the overlay YAML plugin name', () => {
    expect(name).toBe('computer-use-orb-coordinate-mode')
  })

  it('publishes millifraction until Electron pushes pixel', () => {
    const ctx = new Context()
    apply(ctx)
    expect(ctx.orbCoordinateMode.currentMode()).toBe('millifraction')
    expect(DEFAULT_ORB_COORDINATE_MODE).toBe('millifraction')
    setOrbCoordinateMode('millifraction')
    expect(ctx.orbCoordinateMode.currentMode()).toBe('millifraction')
    setOrbCoordinateMode('pixel')
    expect(ctx.orbCoordinateMode.currentMode()).toBe('pixel')
  })

  it('accepts only millifraction and pixel tokens', () => {
    expect(isOrbCoordinateMode('millifraction')).toBe(true)
    expect(isOrbCoordinateMode('pixel')).toBe(true)
    expect(isOrbCoordinateMode('fraction')).toBe(false)
    expect(isOrbCoordinateMode('')).toBe(false)
  })
})
