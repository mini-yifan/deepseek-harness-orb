import { describe, expect, it, vi } from 'vitest'
import { parseSelectionHelperLine, startSelectionMonitor } from '../src/selection-monitor.ts'

describe('selection helper protocol', () => {
  it('parses ready, untrusted, pointer, key, dismiss, and selection lines', () => {
    expect(parseSelectionHelperLine('{"type":"ready"}')).toEqual({ type: 'ready' })
    expect(parseSelectionHelperLine('{"type":"untrusted"}')).toEqual({ type: 'untrusted' })
    expect(parseSelectionHelperLine('{"type":"key"}')).toEqual({ type: 'key' })
    expect(parseSelectionHelperLine('{"type":"dismiss"}')).toEqual({ type: 'dismiss' })
    expect(parseSelectionHelperLine('{"type":"mouse-down","x":10,"y":20}')).toEqual({
      type: 'mouse-down',
      x: 10,
      y: 20,
    })
    expect(parseSelectionHelperLine('{"type":"selection","text":"  hi  ","pid":3,"bundle":"com.app"}')).toEqual({
      type: 'selection',
      text: '  hi  ',
      pid: 3,
      bundle: 'com.app',
    })
    expect(parseSelectionHelperLine('{"type":"selection","text":"hi","bounds":{"x":1,"y":2,"width":3,"height":4}}'))
      .toEqual({
        type: 'selection',
        text: 'hi',
        bounds: { x: 1, y: 2, width: 3, height: 4 },
      })
    expect(parseSelectionHelperLine(
      '{"type":"selection","text":"hi","bounds":{"x":0,"y":0,"width":80,"height":16},"x":400,"y":300}',
    )).toEqual({
      type: 'selection',
      text: 'hi',
      bounds: { x: 0, y: 0, width: 80, height: 16 },
      x: 400,
      y: 300,
    })
  })

  it('drops blank, invalid, and empty-text payloads', () => {
    expect(parseSelectionHelperLine('')).toBeUndefined()
    expect(parseSelectionHelperLine('not-json')).toBeUndefined()
    expect(parseSelectionHelperLine('{"type":"selection","text":"   "}')).toBeUndefined()
    expect(parseSelectionHelperLine('{"type":"mouse-up","x":"1","y":2}')).toBeUndefined()
  })

  it('does not spawn a helper when the binary is missing', () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    expect(startSelectionMonitor({ onEvent: () => undefined })).toBeUndefined()
    vi.unstubAllGlobals()
  })
})
