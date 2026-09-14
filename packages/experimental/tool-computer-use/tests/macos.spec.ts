import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FAKE_DESKTOP_PNG } from '../src/fake.ts'
import {
  createMacosDesktopBackend,
  LIST_SCREENS_SCRIPT,
  macosSckCaptureHelperPath,
  runCommand,
  writeCaptureFile,
  type CommandRunner,
} from '../src/macos.ts'
import { runWithCaptureExcludeWindowIds } from '../src/capture-exclude.ts'

const SCREEN: Record<string, number> = {
  index: 0, x: 0, y: 0, width: 100, height: 50, scale: 2,
}

function screensJson(screens = [SCREEN]): string {
  return JSON.stringify(screens)
}

function runner(options: {
  screens?: string
  capture?: Uint8Array | Error
  osascript?: Error
  scripts?: string[]
  files?: string[]
  args?: string[][]
}): CommandRunner {
  const scripts = options.scripts ?? []
  const files = options.files ?? []
  const capturedArgs = options.args
  return async (file, args) => {
    files.push(file)
    capturedArgs?.push([...args])
    if (file === '/usr/bin/osascript') {
      const script = args[2] === '-e' ? (args[3] ?? '') : await readFile(String(args[2]), 'utf8')
      scripts.push(script)
      if (options.osascript) throw options.osascript
      if (script === LIST_SCREENS_SCRIPT) {
        return { stdout: options.screens ?? screensJson(), stderr: '' }
      }
      return { stdout: '', stderr: '' }
    }
    if (file === '/usr/sbin/screencapture' || file === macosSckCaptureHelperPath()) {
      if (options.capture instanceof Error) throw options.capture
      const output = file === macosSckCaptureHelperPath()
        ? args.find(arg => arg.startsWith('--out='))?.slice('--out='.length)
        : args.at(-1)
      if (typeof output !== 'string') throw new Error('missing capture path')
      await writeCaptureFile(output, options.capture ?? FAKE_DESKTOP_PNG)
      return { stdout: '', stderr: '' }
    }
    throw new Error(`unexpected command ${file}`)
  }
}

describe('runCommand', () => {
  it('captures stdout from a short Node process', async () => {
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write("ok")'])
    expect(result.stdout).toBe('ok')
  })

  it('names the binary when the process fails', async () => {
    await expect(runCommand(process.execPath, ['-e', 'process.exit(1)'])).rejects.toThrow(/failed/u)
  })
})

describe('macOS backend with an injected runner', () => {
  it('lists displays from JXA JSON', async () => {
    const backend = createMacosDesktopBackend(runner({}))
    await expect(backend.listScreens()).resolves.toEqual([{
      index: 0,
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      scale: 2,
    }])
  })

  it('rejects empty or malformed display JSON', async () => {
    await expect(createMacosDesktopBackend(runner({ screens: '[]' })).listScreens())
      .rejects.toThrow(/no displays available/u)
    await expect(createMacosDesktopBackend(runner({ screens: 'not-json' })).listScreens())
      .rejects.toThrow(/failed to list displays/u)
    await expect(createMacosDesktopBackend(runner({ screens: '{}' })).listScreens())
      .rejects.toThrow(/failed to list displays/u)
    await expect(createMacosDesktopBackend(runner({ screens: '[null]' })).listScreens())
      .rejects.toThrow(/failed to list displays/u)
    await expect(createMacosDesktopBackend(runner({
      screens: JSON.stringify([{ index: 0, x: 0, y: 0, width: 0, height: 1, scale: 1 }]),
    })).listScreens()).rejects.toThrow(/failed to list displays/u)
    await expect(createMacosDesktopBackend(runner({
      screens: JSON.stringify([{ x: 1, y: 2, width: 10, height: 20, scale: 1 }]),
    })).listScreens()).resolves.toEqual([{
      index: 0,
      bounds: { x: 1, y: 2, width: 10, height: 20 },
      scale: 1,
    }])
  })

  it('captures PNG bytes written by screencapture', async () => {
    const backend = createMacosDesktopBackend(runner({}))
    const [screen] = await backend.listScreens()
    const captured = await backend.capture(screen!)
    expect(captured.mediaType).toBe('image/png')
    expect(captured.data).toEqual(FAKE_DESKTOP_PNG)
  })

  it('captures JPEG bytes as image/jpeg', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff])
    const backend = createMacosDesktopBackend(runner({ capture: jpeg }))
    const [screen] = await backend.listScreens()
    const captured = await backend.capture(screen!)
    expect(captured.mediaType).toBe('image/jpeg')
  })

  it('uses the ScreenCaptureKit helper when overlay window ids are active', async () => {
    const files: string[] = []
    const args: string[][] = []
    const backend = createMacosDesktopBackend(runner({ files, args }))
    const [screen] = await backend.listScreens()
    files.length = 0
    args.length = 0
    const captured = await runWithCaptureExcludeWindowIds([4242], () => backend.capture(screen!))
    expect(captured.mediaType).toBe('image/png')
    expect(files).toEqual([macosSckCaptureHelperPath()])
    expect(args[0]).toEqual([
      '--rect=0,0,100,50',
      '--exclude=4242',
      expect.stringMatching(/^--out=/u),
    ])
  })

  it('does not fall back to screencapture when overlay-exclude capture fails', async () => {
    const files: string[] = []
    const backend = createMacosDesktopBackend(runner({
      files,
      capture: new Error('window missing'),
    }))
    const [screen] = await backend.listScreens()
    files.length = 0
    await expect(runWithCaptureExcludeWindowIds([7], () => backend.capture(screen!)))
      .rejects.toThrow(/overlay-exclude capture failed/u)
    expect(files).toEqual([macosSckCaptureHelperPath()])
  })


  it('names Screen Recording when capture fails', async () => {
    const backend = createMacosDesktopBackend(runner({ capture: new Error('denied') }))
    const [screen] = await backend.listScreens()
    await expect(backend.capture(screen!)).rejects.toThrow(/Screen Recording permission/u)
  })

  it('rejects unsupported capture bytes', async () => {
    const backend = createMacosDesktopBackend(runner({ capture: Buffer.from('not-an-image') }))
    const [screen] = await backend.listScreens()
    await expect(backend.capture(screen!)).rejects.toThrow(/unsupported image/u)
  })

  it('posts click, type, scroll, and hotkey JXA', async () => {
    const scripts: string[] = []
    const backend = createMacosDesktopBackend(runner({ scripts }))
    const [screen] = await backend.listScreens()
    scripts.length = 0
    await backend.click({ screen: screen!, position: [0, 0], button: 'right', count: 2 })
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain('clickAt(0, 0, 1, 2)')
    expect(scripts[0]).toContain('CGEventSourceCreate(1)')
    expect(scripts[0]).toContain('CGPointMake')
    expect(scripts[0]).toContain('sleep(80)')
    scripts.length = 0
    await backend.click({ screen: screen!, position: [0, 0], button: 'left', count: 1 })
    expect(scripts[0]).toContain('clickAt(0, 0, 0, 1)')
    scripts.length = 0
    await backend.typeText({
      screen: screen!, position: [500, 500], text: 'hi', replace: true, submit: true,
    })
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain('clickAt(50, 25, 0, 1)')
    expect(scripts[0]).toContain('sleep(120)')
    expect(scripts[0]).toContain('selectAll()')
    expect(scripts[0]).toContain('pasteText("hi")')
    expect(scripts[0]).toContain('pressEnter()')
    expect(scripts[0]).toContain('var discarded = pb.clearContents')
    expect(scripts[0]).not.toContain('pb.clearContents()')
    expect(scripts[0]).not.toContain('KeyboardSetUnicodeString')
    scripts.length = 0
    await backend.typeText({
      screen: screen!, position: [0, 0], text: '', replace: false, submit: false,
    })
    expect(scripts.join('\n')).toContain('clickAt(0, 0, 0, 1)')
    expect(scripts.join('\n')).not.toContain('pasteText("')
    scripts.length = 0
    await backend.scroll({ screen: screen!, position: [10, 10], direction: 'down', scrollLevel: 3 })
    expect(scripts.join('\n')).toContain('CGEventCreateScrollWheelEvent2')
    expect(scripts.join('\n')).toContain('scrollAt(1, 1, -3)')
    scripts.length = 0
    await backend.scroll({ screen: screen!, position: [10, 10], direction: 'up', scrollLevel: 2 })
    expect(scripts.join('\n')).toContain('scrollAt(1, 1, 2)')
    scripts.length = 0
    await backend.hotkey({ keys: ['cmd', 'c'] })
    expect(scripts.join('\n')).toContain('chord([55,8])')
    expect(scripts.join('\n')).toContain('CGEventSetFlags')
  })

  it('rejects unknown hotkeys before posting', async () => {
    const backend = createMacosDesktopBackend(runner({}))
    await expect(backend.hotkey({ keys: ['not-a-key'] })).rejects.toThrow(/unknown key "not-a-key"/u)
  })

  it('names Accessibility when HID posting fails', async () => {
    const mixed: CommandRunner = async (file, args, options) => {
      if (file === '/usr/bin/osascript' && !(args[2] === '-e' && args[3] === LIST_SCREENS_SCRIPT)) {
        throw new Error('denied')
      }
      return runner({})(file, args, options)
    }
    const hid = createMacosDesktopBackend(mixed)
    const [screen] = await hid.listScreens()
    await expect(hid.click({
      screen: screen!, position: [0, 0], button: 'left', count: 1,
    })).rejects.toThrow(/Accessibility permission/u)
    await expect(hid.typeText({
      screen: screen!, position: [0, 0], text: 'a', replace: false, submit: false,
    })).rejects.toThrow(/Accessibility permission/u)
    await expect(hid.scroll({
      screen: screen!, position: [0, 0], direction: 'up', scrollLevel: 1,
    })).rejects.toThrow(/Accessibility permission/u)
    await expect(hid.hotkey({ keys: ['c'] })).rejects.toThrow(/Accessibility permission/u)
  })

  it('stringifies non-Error HID failures', async () => {
    const mixed: CommandRunner = async (file, args, options) => {
      if (file === '/usr/bin/osascript' && !(args[2] === '-e' && args[3] === LIST_SCREENS_SCRIPT)) {
        throw 'denied'
      }
      return runner({})(file, args, options)
    }
    const hid = createMacosDesktopBackend(mixed)
    const [screen] = await hid.listScreens()
    await expect(hid.click({
      screen: screen!, position: [0, 0], button: 'left', count: 1,
    })).rejects.toThrow(/Accessibility permission is required\): denied/u)
    await expect(hid.typeText({
      screen: screen!, position: [0, 0], text: 'a', replace: false, submit: false,
    })).rejects.toThrow(/Accessibility permission is required\): denied/u)
    await expect(hid.scroll({
      screen: screen!, position: [0, 0], direction: 'up', scrollLevel: 1,
    })).rejects.toThrow(/Accessibility permission is required\): denied/u)
    await expect(hid.hotkey({ keys: ['c'] })).rejects.toThrow(/Accessibility permission is required\): denied/u)
  })

  it('stringifies non-Error capture failures', async () => {
    const mixed: CommandRunner = async (file, args, options) => {
      if (file === '/usr/sbin/screencapture') throw 'denied'
      return runner({})(file, args, options)
    }
    const backend = createMacosDesktopBackend(mixed)
    const [screen] = await backend.listScreens()
    await expect(backend.capture(screen!)).rejects.toThrow(/Screen Recording permission is required\): denied/u)
  })
})

describe('writeCaptureFile', () => {
  it('writes the bytes a capture runner would emit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-cu-cap-'))
    const file = join(dir, 'out.jpg')
    await writeCaptureFile(file, FAKE_DESKTOP_PNG)
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(file)).toEqual(FAKE_DESKTOP_PNG)
  })
})
