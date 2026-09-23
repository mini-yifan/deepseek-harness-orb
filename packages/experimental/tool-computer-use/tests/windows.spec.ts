import { describe, expect, it, vi } from 'vitest'

const produced = vi.hoisted(() => ({ count: 0 }))

vi.mock('../src/windows-native.ts', () => ({
  createProductionWindowsOps: () => {
    produced.count += 1
    return {
      listWindows: () => ({ foregroundHwnd: 0, windows: [] }),
      capturePng: () => Uint8Array.from([]),
      targetBlocksInput: () => false,
      movePointer: () => undefined,
      mouseButton: () => undefined,
      scrollWheel: () => undefined,
      key: () => undefined,
      readClipboardText: () => '',
      setClipboardText: () => undefined,
      copyImageFile: () => undefined,
      listWindowApps: () => [],
      activateApp: () => false,
      launch: () => undefined,
      explorerFolder: () => undefined,
    }
  },
}))
import { runWithCaptureExcludeWindowIds } from '../src/capture-exclude.ts'
import type { WindowsDesktopSnapshot, WindowsWindowFact } from '../src/windows-foreground.ts'
import {
  createWindowsDesktopBackend,
  encodeBgraPng,
  windowsKeyIsExtended,
  windowsVirtualKey,
  type WindowsDesktopOps,
} from '../src/windows.ts'

const bounds = { x: 10, y: 20, width: 100, height: 80 }
const png = encodeBgraPng(1, 1, Buffer.from([1, 2, 3, 255]), false)

function fact(overrides: Partial<WindowsWindowFact> = {}): WindowsWindowFact {
  return {
    hwnd: 5,
    pid: 10,
    ownerHwnd: 0,
    className: 'Notepad',
    appName: 'notepad',
    title: 'notes.txt',
    visible: true,
    iconic: false,
    cloaked: false,
    toolWindow: false,
    popup: false,
    frame: bounds,
    monitor: { x: 0, y: 0, width: 1920, height: 1080 },
    monitorDpi: 96,
    ...overrides,
  }
}

function shot(windows: readonly WindowsWindowFact[], foregroundHwnd = windows[0]?.hwnd ?? 0): WindowsDesktopSnapshot {
  return { foregroundHwnd, windows }
}

function ops(overrides: Partial<WindowsDesktopOps> = {}): WindowsDesktopOps & {
  readonly calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    listWindows: () => shot([fact()]),
    capturePng: () => png,
    targetBlocksInput: () => false,
    movePointer: (x, y) => { calls.push(`move:${String(x)},${String(y)}`) },
    mouseButton: (_button, down) => { calls.push(down ? 'down' : 'up') },
    scrollWheel: (_x, _y, delta) => { calls.push(`wheel:${String(delta)}`) },
    key: (virtualKey, down, extended) => {
      calls.push(`key:${String(virtualKey)}:${down ? 'down' : 'up'}:${extended ? '1' : '0'}`)
    },
    readClipboardText: () => 'previous',
    setClipboardText: (text) => { calls.push(`clip:${text}`) },
    copyImageFile: (path) => { calls.push(`image:${path}`) },
    listWindowApps: () => ['notepad', 'explorer'],
    activateApp: () => false,
    launch: (target) => { calls.push(`launch:${target}`) },
    explorerFolder: () => undefined,
    ...overrides,
  }
}

describe('windows desktop backend', () => {
  it('encodes a one-pixel PNG and maps key names', () => {
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(encodeBgraPng(1, 1, Buffer.from([1, 2, 3, 255]), true).byteLength).toBeGreaterThan(8)
    expect(encodeBgraPng(1, 1, Buffer.alloc(0), false).byteLength).toBeGreaterThan(8)
    expect(windowsVirtualKey('ctrl')).toBe(0x11)
    expect(windowsVirtualKey('V')).toBe(0x56)
    expect(windowsVirtualKey('5')).toBe(0x35)
    expect(windowsVirtualKey('f12')).toBe(0x7B)
    expect(windowsVirtualKey('insert')).toBe(0x2D)
    expect(windowsKeyIsExtended('Delete')).toBe(true)
    expect(windowsKeyIsExtended('a')).toBe(false)
    expect(() => { windowsVirtualKey('not-a-key') }).toThrow(/unknown key/u)
  })

  it('captures the selected window and reports an Explorer folder as finderFolder', async () => {
    const popup = fact({
      hwnd: 6,
      popup: true,
      title: '',
      frame: { x: 90, y: 20, width: 40, height: 80 },
    })
    const host = ops({
      listWindows: () => shot([fact({ appName: 'explorer', title: 'notes.txt' }), popup]),
      explorerFolder: hwnd => (hwnd === 5 ? 'C:\\work' : undefined),
    })
    const backend = createWindowsDesktopBackend(host)
    const screens = await backend.listScreens()
    expect(screens).toEqual([{
      index: 0,
      bounds: { x: 10, y: 20, width: 120, height: 80 },
      scale: 1,
      windowId: 5,
      transientWindowIds: [6],
    }])
    await expect(backend.capture(screens[0]!)).resolves.toEqual({ data: png, mediaType: 'image/png' })
    await expect(backend.inspectForeground()).resolves.toEqual({
      appName: 'explorer',
      windowTitle: 'notes.txt',
      finderFolder: 'C:\\work',
    })
    await expect(backend.listApps()).resolves.toEqual(['notepad', 'explorer'])
  })

  it('skips an excluded foreground hwnd and omits an empty title', async () => {
    const ball = fact({ hwnd: 9, appName: 'electron', title: 'ball', frame: { x: 0, y: 0, width: 80, height: 80 } })
    const notes = fact({ title: '   ' })
    const host = ops({ listWindows: () => shot([ball, notes], 9) })
    const backend = createWindowsDesktopBackend(host)
    await runWithCaptureExcludeWindowIds([9], async () => {
      await expect(backend.listScreens()).resolves.toEqual([{
        index: 0,
        bounds,
        scale: 1,
        windowId: 5,
      }])
      await expect(backend.inspectForeground()).resolves.toEqual({ appName: 'notepad' })
    })
  })

  it('clicks, double-clicks, and pastes through the clipboard before restoring it', async () => {
    const host = ops()
    const screen = { index: 0, bounds, scale: 1 }
    const backend = createWindowsDesktopBackend(host)
    await backend.click({ screen, position: [0, 0], button: 'left', count: 1 })
    expect(host.calls).toEqual(['move:10,20', 'down', 'up'])
    host.calls.length = 0
    await backend.click({ screen, position: [1000, 1000], button: 'right', count: 2 })
    expect(host.calls).toEqual(['move:110,100', 'down', 'up', 'down', 'up'])
    host.calls.length = 0
    await backend.typeText({ screen, position: [500, 1000], text: 'hi', replace: true, submit: true })
    const pasteUp = host.calls.indexOf('key:86:up:0')
    const restore = host.calls.indexOf('clip:previous')
    expect(host.calls).toContain('clip:hi')
    expect(host.calls.indexOf('clip:hi')).toBeLessThan(host.calls.indexOf('key:86:down:0'))
    expect(pasteUp).toBeGreaterThan(-1)
    expect(restore).toBeGreaterThan(pasteUp)
    expect(host.calls.at(-1)).toBe('clip:previous')
    expect(host.calls).toContain('key:13:down:0')
    host.calls.length = 0
    await backend.typeText({ screen, position: [0, 0], text: 'x', replace: false, submit: false })
    expect(host.calls).not.toContain('key:65:down:0')
    expect(host.calls).not.toContain('key:13:down:0')
    expect(host.calls.at(-1)).toBe('clip:previous')
  })

  it('posts extended navigation keys, modifier chords, and one wheel notch per level', async () => {
    const host = ops()
    const screen = { index: 0, bounds, scale: 1 }
    const backend = createWindowsDesktopBackend(host)
    await backend.hotkey({ keys: ['ctrl', 'c'] })
    expect(host.calls).toEqual([
      'key:17:down:0',
      'key:67:down:0',
      'key:67:up:0',
      'key:17:up:0',
    ])
    host.calls.length = 0
    await backend.hotkey({ keys: ['delete'] })
    expect(host.calls).toEqual(['key:46:down:1', 'key:46:up:1'])
    host.calls.length = 0
    await backend.hotkey({ keys: ['win'] })
    expect(host.calls).toEqual(['key:91:down:0', 'key:91:up:0'])
    host.calls.length = 0
    await backend.hotkey({ keys: [] })
    expect(host.calls).toEqual([])
    await backend.scroll({ screen, position: [0, 0], direction: 'down', scrollLevel: 2 })
    expect(host.calls).toEqual(['wheel:-120', 'wheel:-120'])
    host.calls.length = 0
    await backend.scroll({ screen, position: [0, 0], direction: 'up', scrollLevel: 1 })
    expect(host.calls).toEqual(['wheel:120'])
  })

  it('drags in steps and holds a long press', async () => {
    const host = ops()
    const screen = { index: 0, bounds, scale: 1 }
    const backend = createWindowsDesktopBackend(host)
    await backend.drag({
      startScreen: screen,
      startPosition: [0, 0],
      endScreen: screen,
      endPosition: [1000, 1000],
    })
    const moves = host.calls.filter(call => call.startsWith('move:'))
    expect(moves).toHaveLength(11)
    expect(moves[0]).toBe('move:10,20')
    expect(moves.at(-1)).toBe('move:110,100')
    expect(host.calls.filter(call => call === 'down')).toEqual(['down'])
    expect(host.calls.at(-1)).toBe('up')
    host.calls.length = 0
    await backend.longPress({ screen, position: [0, 0], durationSeconds: 0 })
    expect(host.calls).toEqual(['move:10,20', 'down', 'up'])
  })

  it('refuses input into an elevated window and opens Explorer for reveal', async () => {
    let blocked = true
    const host = ops({
      targetBlocksInput: () => blocked,
      activateApp: (name) => {
        if (name === 'stuck') throw new Error('computer-use: failed to activate stuck')
        return name === 'notepad'
      },
    })
    const backend = createWindowsDesktopBackend(host)
    await expect(backend.hotkey({ keys: ['ctrl', 'c'] })).rejects.toThrow(/elevated/u)
    blocked = false
    await expect(backend.openApp({ name: 'notepad' })).resolves.toEqual({ kind: 'activated', name: 'notepad' })
    await expect(backend.openApp({ name: 'calc' })).resolves.toEqual({ kind: 'launched', name: 'calc' })
    expect(host.calls).toContain('launch:calc')
    await expect(backend.openApp({ name: 'stuck' })).rejects.toThrow(/failed to activate/u)
    await backend.openInFinder({ path: 'C:\\work\\a.txt', revealOnly: true })
    expect(host.calls).toContain('launch:explorer.exe')
    await backend.openInFinder({ path: 'C:\\work', revealOnly: false })
    expect(host.calls).toContain('launch:C:\\work')
    await backend.openInBrowser({})
    expect(host.calls).toContain('launch:https://')
    await backend.openInBrowser({ url: 'https://example.com' })
    expect(host.calls).toContain('launch:https://example.com')
    await backend.copyImageToClipboard({ path: 'C:\\shot.png', mediaType: 'image/png' })
    expect(host.calls).toContain('image:C:\\shot.png')
  })

  it('wraps capture failures and returns no screen when nothing is operable', async () => {
    const screen = { index: 0, bounds, scale: 1 }
    const prefixed = createWindowsDesktopBackend(ops({
      capturePng: () => { throw new Error('computer-use: denied') },
    }))
    await expect(prefixed.capture(screen)).rejects.toThrow('computer-use: denied')
    const wrapped = createWindowsDesktopBackend(ops({
      capturePng: () => { throw new Error('disk') },
    }))
    await expect(wrapped.capture(screen)).rejects.toThrow('computer-use: screen capture failed: disk')
    const unknown = createWindowsDesktopBackend(ops({
      capturePng: () => { throw 'disk' },
    }))
    await expect(unknown.capture(screen)).rejects.toThrow('computer-use: screen capture failed: disk')
    const backend = createWindowsDesktopBackend(ops({ listWindows: () => shot([]) }))
    await expect(backend.listScreens()).resolves.toEqual([])
    await expect(backend.inspectForeground()).resolves.toMatchObject({ appName: 'none' })
    await expect(backend.withGuiTurn(() => Promise.resolve(4))).resolves.toBe(4)
  })

  it('loads Win32 operations once when no host is injected', async () => {
    const backend = createWindowsDesktopBackend()
    await expect(backend.listScreens()).resolves.toEqual([])
    await expect(backend.listScreens()).resolves.toEqual([])
    expect(produced.count).toBe(1)
  })
})
