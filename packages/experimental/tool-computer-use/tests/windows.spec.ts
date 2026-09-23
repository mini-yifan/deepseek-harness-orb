import { describe, expect, it } from 'vitest'
import {
  createWindowsDesktopBackend,
  encodeBgraPng,
  windowsVirtualKey,
  type WindowsDesktopOps,
  type WindowsForeground,
} from '../src/windows.ts'

const screen = { index: 0, bounds: { x: 10, y: 20, width: 100, height: 50 }, scale: 1 }
const png = encodeBgraPng(1, 1, Buffer.from([1, 2, 3, 255]), false)

function foreground(overrides: Partial<WindowsForeground> = {}): WindowsForeground {
  return {
    appName: 'notepad',
    windowTitle: 'notes.txt',
    bounds: screen.bounds,
    scale: 1,
    ...overrides,
  }
}

function ops(overrides: Partial<WindowsDesktopOps> = {}): WindowsDesktopOps & {
  readonly calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    foreground: () => foreground(),
    capturePng: () => png,
    targetBlocksInput: () => false,
    movePointer: () => { calls.push('move') },
    mouseButton: (_button, down) => { calls.push(down ? 'down' : 'up') },
    scrollWheel: () => { calls.push('wheel') },
    key: (virtualKey, down) => { calls.push(`key:${String(virtualKey)}:${down ? 'down' : 'up'}`) },
    readClipboardText: () => 'previous',
    setClipboardText: (text) => { calls.push(`clip:${text}`) },
    copyImageFile: (path) => { calls.push(`image:${path}`) },
    listWindowApps: () => ['notepad', 'explorer'],
    activateApp: () => false,
    launch: (target) => { calls.push(`launch:${target}`) },
    ...overrides,
  }
}

describe('windows desktop backend', () => {
  it('encodes a one-pixel PNG and maps letters to virtual keys', () => {
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(windowsVirtualKey('ctrl')).toBe(0x11)
    expect(windowsVirtualKey('V')).toBe(0x56)
    expect(windowsVirtualKey('f12')).toBe(0x7B)
    expect(() => { windowsVirtualKey('not-a-key') }).toThrow(/unknown key/u)
  })

  it('captures the foreground window and reports an Explorer folder as finderFolder', async () => {
    const host = ops({
      foreground: () => foreground({ appName: 'explorer', explorerFolder: 'C:\\work' }),
    })
    const backend = createWindowsDesktopBackend(host)
    await expect(backend.listScreens()).resolves.toEqual([{ index: 0, bounds: screen.bounds, scale: 1 }])
    await expect(backend.capture(screen)).resolves.toEqual({ data: png, mediaType: 'image/png' })
    await expect(backend.inspectForeground()).resolves.toEqual({
      appName: 'explorer',
      windowTitle: 'notes.txt',
      finderFolder: 'C:\\work',
    })
    await expect(backend.listApps()).resolves.toEqual(['notepad', 'explorer'])
  })

  it('clicks, pastes through the clipboard, and restores the previous text', async () => {
    const host = ops()
    const backend = createWindowsDesktopBackend(host)
    await backend.click({ screen, position: [0, 0], button: 'left', count: 1 })
    expect(host.calls).toEqual(['move', 'down', 'up'])
    host.calls.length = 0
    await backend.typeText({ screen, position: [500, 1000], text: 'hi', replace: true, submit: true })
    expect(host.calls).toContain('clip:hi')
    expect(host.calls.at(-1)).toBe('clip:previous')
    expect(host.calls).toContain('key:17:down')
    expect(host.calls).toContain('key:86:down')
    expect(host.calls).toContain('key:13:down')
  })

  it('refuses input into an elevated window and opens Explorer for reveal', async () => {
    let blocked = true
    const host = ops({
      targetBlocksInput: () => blocked,
      activateApp: name => name === 'notepad',
    })
    const backend = createWindowsDesktopBackend(host)
    await expect(backend.hotkey({ keys: ['ctrl', 'c'] })).rejects.toThrow(/elevated/u)
    blocked = false
    await expect(backend.openApp({ name: 'notepad' })).resolves.toEqual({ kind: 'activated', name: 'notepad' })
    await expect(backend.openApp({ name: 'calc' })).resolves.toEqual({ kind: 'launched', name: 'calc' })
    expect(host.calls).toContain('launch:calc')
    await backend.openInFinder({ path: 'C:\\work\\a.txt', revealOnly: true })
    expect(host.calls).toContain('launch:explorer.exe')
    await backend.openInBrowser({ url: 'https://example.com' })
    expect(host.calls).toContain('launch:https://example.com')
    await backend.copyImageToClipboard({ path: 'C:\\shot.png', mediaType: 'image/png' })
    expect(host.calls).toContain('image:C:\\shot.png')
    await backend.scroll({ screen, position: [0, 0], direction: 'down', scrollLevel: 2 })
    expect(host.calls).toContain('wheel')
  })

  it('returns no screen when nothing is in front', async () => {
    const backend = createWindowsDesktopBackend(ops({ foreground: () => undefined }))
    await expect(backend.listScreens()).resolves.toEqual([])
    await expect(backend.inspectForeground()).resolves.toMatchObject({ appName: 'none' })
    await expect(backend.withGuiTurn(() => Promise.resolve(4))).resolves.toBe(4)
  })
})
