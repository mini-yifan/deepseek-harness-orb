import { readFile } from 'node:fs/promises'
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

  it('does not start a monitor off macOS and Windows', () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    expect(startSelectionMonitor({ onEvent: () => undefined })).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('monitors in the Electron process and never changes activation policy', async () => {
    const napi = await readFile(new URL('../src/macos-selection-napi.c', import.meta.url), 'utf8')
    const swift = await readFile(new URL('../src/macos-selection.swift', import.meta.url), 'utf8')
    expect(napi).toContain('napi_create_threadsafe_function')
    expect(napi).toContain('dsh_macos_selection_start')
    expect(napi).not.toContain('activationPolicy')
    expect(swift).toContain('@_cdecl("dsh_macos_selection_start")')
    expect(swift).toContain('NSWorkspace.didActivateApplicationNotification')
    expect(swift).toContain('@_cdecl("dsh_macos_selection_last_front_pid")')
    const library = swift.split('@_cdecl("dsh_macos_selection_start")')[1] ?? ''
    expect(library).not.toContain('setActivationPolicy')
  })
})
