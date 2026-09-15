import { describe, expect, it } from 'vitest'
import { createUnsupportedDesktopBackend, UNSUPPORTED_DESKTOP_MESSAGE } from '../src/unsupported.ts'
import { createPlatformBackend } from '../src/backend.ts'

describe('unsupported desktop', () => {
  it('throws the fixed macOS-only message from every method', async () => {
    const backend = createUnsupportedDesktopBackend()
    await expect(backend.listScreens()).rejects.toThrow(UNSUPPORTED_DESKTOP_MESSAGE)
    await expect(backend.capture({
      index: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, scale: 1,
    })).rejects.toThrow(UNSUPPORTED_DESKTOP_MESSAGE)
    await expect(backend.click({
      screen: { index: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, scale: 1 },
      position: [0, 0],
      button: 'left',
      count: 1,
    })).rejects.toThrow(UNSUPPORTED_DESKTOP_MESSAGE)
    await expect(backend.typeText({
      screen: { index: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, scale: 1 },
      position: [0, 0],
      text: 'x',
      replace: false,
      submit: false,
    })).rejects.toThrow(UNSUPPORTED_DESKTOP_MESSAGE)
    await expect(backend.scroll({
      screen: { index: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, scale: 1 },
      position: [0, 0],
      direction: 'down',
      scrollLevel: 1,
    })).rejects.toThrow(UNSUPPORTED_DESKTOP_MESSAGE)
    await expect(backend.hotkey({ keys: ['c'] })).rejects.toThrow(UNSUPPORTED_DESKTOP_MESSAGE)
    await expect(backend.inspectForeground()).rejects.toThrow(UNSUPPORTED_DESKTOP_MESSAGE)
    await expect(backend.longPress({
      screen: { index: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, scale: 1 },
      position: [0, 0],
      durationSeconds: 3,
    })).rejects.toThrow(UNSUPPORTED_DESKTOP_MESSAGE)
    await expect(backend.drag({
      startScreen: { index: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, scale: 1 },
      startPosition: [0, 0],
      endScreen: { index: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, scale: 1 },
      endPosition: [10, 10],
    })).rejects.toThrow(UNSUPPORTED_DESKTOP_MESSAGE)
    await expect(backend.openInBrowser({})).rejects.toThrow(UNSUPPORTED_DESKTOP_MESSAGE)
    await expect(backend.openInFinder({ path: '/tmp', revealOnly: false })).rejects.toThrow(UNSUPPORTED_DESKTOP_MESSAGE)
  })

  it('selects the unsupported backend off Darwin without capturing', async () => {
    await expect(createPlatformBackend('linux').listScreens()).rejects.toThrow(UNSUPPORTED_DESKTOP_MESSAGE)
  })

  it('constructs the macOS backend on Darwin without posting input', () => {
    expect(typeof createPlatformBackend('darwin').click).toBe('function')
  })
})
