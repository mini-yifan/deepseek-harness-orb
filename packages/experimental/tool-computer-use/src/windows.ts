/**
 * Windows desktop capture (GDI) and HID input (`SendInput`).
 * Production loads `user32` / `gdi32` through koffi on the first call.
 * Tests inject {@link WindowsDesktopOps} and never post real input.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/windows
 */

import { deflateSync, crc32 } from 'node:zlib'
import type {
  CapturedScreen,
  ClickInput,
  CopyImageToClipboardInput,
  DesktopBackend,
  DesktopForeground,
  DragInput,
  HotkeyInput,
  LongPressInput,
  OpenAppInput,
  OpenAppResult,
  OpenInBrowserInput,
  OpenInFinderInput,
  ScreenInfo,
  ScrollInput,
  TypeInput,
} from './backend.ts'
import { FOCUS_FALLBACK_FOREGROUND } from './backend.ts'
import { mapNormalizedToGlobal } from './coordinates.ts'
import { delay } from './wait.ts'

/** Logical screen rectangle in virtual-screen pixels. */
export interface WindowsRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Frontmost window facts the Windows backend maps into {@link DesktopForeground}. */
export interface WindowsForeground {
  readonly appName: string
  readonly windowTitle: string
  readonly bounds: WindowsRect
  readonly scale: number
  /** Explorer address path when the frontmost window is File Explorer. */
  readonly explorerFolder?: string
}

/**
 * Host operations behind the Windows backend.
 * Production uses Win32. Tests supply fakes.
 */
export interface WindowsDesktopOps {
  foreground(): WindowsForeground | undefined
  capturePng(bounds: WindowsRect): Uint8Array
  /** True when the foreground window is elevated above this process (UIPI). */
  targetBlocksInput(): boolean
  movePointer(x: number, y: number): void
  mouseButton(button: 'left' | 'right', down: boolean): void
  scrollWheel(x: number, y: number, delta: number): void
  key(virtualKey: number, down: boolean): void
  readClipboardText(): string
  setClipboardText(text: string): void
  copyImageFile(path: string): void
  listWindowApps(): readonly string[]
  /** Bring a running app forward. False when no window matches `name`. */
  activateApp(name: string): boolean
  launch(target: string, parameters?: string): void
}

const ELEVATED_WINDOW = 'computer-use: the foreground window is running elevated, so this process cannot click or type into it'

const KEY_NAMES: Readonly<Record<string, number>> = {
  ctrl: 0x11,
  control: 0x11,
  alt: 0x12,
  option: 0x12,
  shift: 0x10,
  win: 0x5B,
  windows: 0x5B,
  meta: 0x5B,
  cmd: 0x5B,
  command: 0x5B,
  super: 0x5B,
  enter: 0x0D,
  return: 0x0D,
  tab: 0x09,
  escape: 0x1B,
  esc: 0x1B,
  space: 0x20,
  backspace: 0x08,
  delete: 0x2E,
  del: 0x2E,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
}

/**
 * Map one hotkey token to a Win32 virtual-key code.
 * @param key - model-supplied key name.
 * @returns the virtual-key code.
 * @throws when the token is not a known key, letter, digit, or function key.
 */
export function windowsVirtualKey(key: string): number {
  const token = key.trim().toLowerCase()
  const named = KEY_NAMES[token]
  if (named !== undefined) return named
  if (/^[a-z]$/u.test(token)) return token.toUpperCase().charCodeAt(0)
  if (/^[0-9]$/u.test(token)) return token.charCodeAt(0)
  const fn = /^f([1-9]|1[0-2])$/u.exec(token)
  if (fn !== null) return 0x70 + Number(fn[1]) - 1
  throw new Error(`computer-use: unknown key ${JSON.stringify(key)}`)
}

/**
 * Encode a 32-bit BGRA buffer as a PNG.
 * @param width - pixel width.
 * @param height - pixel height.
 * @param bgra - tightly packed BGRA pixels, one row after another.
 * @param bottomUp - true when the first row in `bgra` is the bottom of the image.
 * @returns PNG bytes.
 */
export function encodeBgraPng(width: number, height: number, bgra: Buffer, bottomUp: boolean): Uint8Array {
  const rowBytes = width * 4
  const raw = Buffer.alloc((rowBytes + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const sourceY = bottomUp ? height - 1 - y : y
    const dest = y * (rowBytes + 1)
    raw[dest] = 0
    for (let x = 0; x < width; x += 1) {
      const source = sourceY * rowBytes + x * 4
      const pixel = dest + 1 + x * 4
      raw[pixel] = bgra[source + 2] ?? 0
      raw[pixel + 1] = bgra[source + 1] ?? 0
      raw[pixel + 2] = bgra[source] ?? 0
      raw[pixel + 3] = 255
    }
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const name = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0)
  return Buffer.concat([length, name, data, crc])
}

function liveSignal(signal: AbortSignal | undefined): AbortSignal {
  return signal ?? new AbortController().signal
}

function pointOf(position: readonly [number, number], screen: ScreenInfo): { x: number; y: number } {
  const mapped = mapNormalizedToGlobal(position, screen)
  return { x: Math.round(mapped.x), y: Math.round(mapped.y) }
}

function assertInput(ops: WindowsDesktopOps): void {
  if (ops.targetBlocksInput()) throw new Error(ELEVATED_WINDOW)
}

async function clickAt(
  ops: WindowsDesktopOps,
  button: 'left' | 'right',
  count: number,
  point: { x: number; y: number },
  signal: AbortSignal,
): Promise<void> {
  ops.movePointer(point.x, point.y)
  for (let index = 0; index < count; index += 1) {
    await delay(20, signal)
    ops.mouseButton(button, true)
    await delay(20, signal)
    ops.mouseButton(button, false)
  }
}

function chord(ops: WindowsDesktopOps, keys: readonly number[]): void {
  for (const key of keys) ops.key(key, true)
  for (const key of [...keys].reverse()) ops.key(key, false)
}

let productionOps: WindowsDesktopOps | undefined

async function production(): Promise<WindowsDesktopOps> {
  productionOps ??= (await import('./windows-native.ts')).createProductionWindowsOps()
  return productionOps
}

/**
 * Construct the Windows backend.
 * @param ops - injected host operations. Omit to use Win32 on the first call.
 * @returns capture and HID input against the host desktop.
 */
export function createWindowsDesktopBackend(ops?: WindowsDesktopOps): DesktopBackend {
  const use = async (): Promise<WindowsDesktopOps> => ops ?? await production()

  return {
    withGuiTurn: run => run(),

    async listScreens(signal) {
      signal?.throwIfAborted()
      const front = (await use()).foreground()
      if (front === undefined) return []
      const screen: ScreenInfo = { index: 0, bounds: front.bounds, scale: front.scale }
      return [screen]
    },

    async capture(screen, signal): Promise<CapturedScreen> {
      signal?.throwIfAborted()
      try {
        const data = (await use()).capturePng(screen.bounds)
        return { data, mediaType: 'image/png' }
      } catch (error: unknown) {
        if (error instanceof Error && error.message.startsWith('computer-use:')) throw error
        throw new Error(`computer-use: screen capture failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    },

    async inspectForeground(signal) {
      signal?.throwIfAborted()
      const front = (await use()).foreground()
      if (front === undefined) return FOCUS_FALLBACK_FOREGROUND
      const foreground: DesktopForeground = {
        appName: front.appName,
        ...front.windowTitle === '' ? {} : { windowTitle: front.windowTitle },
        ...front.explorerFolder === undefined ? {} : { finderFolder: front.explorerFolder },
      }
      return foreground
    },

    async listApps(signal) {
      signal?.throwIfAborted()
      return (await use()).listWindowApps()
    },

    async openApp(input: OpenAppInput, signal): Promise<OpenAppResult> {
      signal?.throwIfAborted()
      const host = await use()
      if (host.activateApp(input.name)) return { kind: 'activated', name: input.name }
      host.launch(input.name)
      return { kind: 'launched', name: input.name }
    },

    async click(input: ClickInput, signal) {
      const host = await use()
      assertInput(host)
      await clickAt(host, input.button, input.count, pointOf(input.position, input.screen), liveSignal(signal))
    },

    async typeText(input: TypeInput, signal) {
      const host = await use()
      assertInput(host)
      const abort = liveSignal(signal)
      await clickAt(host, 'left', 1, pointOf(input.position, input.screen), abort)
      if (input.replace) chord(host, [0x11, 0x41])
      const previous = host.readClipboardText()
      try {
        host.setClipboardText(input.text)
        await delay(30, abort)
        chord(host, [0x11, 0x56])
        if (input.submit) {
          await delay(30, abort)
          chord(host, [0x0D])
        }
      } finally {
        host.setClipboardText(previous)
      }
    },

    async scroll(input: ScrollInput, signal) {
      const host = await use()
      assertInput(host)
      const point = pointOf(input.position, input.screen)
      const delta = (input.direction === 'up' ? 1 : -1) * input.scrollLevel * 120
      host.scrollWheel(point.x, point.y, delta)
      signal?.throwIfAborted()
    },

    async hotkey(input: HotkeyInput, signal) {
      signal?.throwIfAborted()
      const host = await use()
      assertInput(host)
      chord(host, input.keys.map(windowsVirtualKey))
    },

    async longPress(input: LongPressInput, signal) {
      const host = await use()
      assertInput(host)
      const point = pointOf(input.position, input.screen)
      const abort = liveSignal(signal)
      host.movePointer(point.x, point.y)
      await delay(20, abort)
      host.mouseButton('left', true)
      try {
        await delay(Math.round(input.durationSeconds * 1000), abort)
      } finally {
        host.mouseButton('left', false)
      }
    },

    async drag(input: DragInput, signal) {
      const host = await use()
      assertInput(host)
      const start = pointOf(input.startPosition, input.startScreen)
      const end = pointOf(input.endPosition, input.endScreen)
      const abort = liveSignal(signal)
      host.movePointer(start.x, start.y)
      await delay(20, abort)
      host.mouseButton('left', true)
      await delay(20, abort)
      host.movePointer(end.x, end.y)
      await delay(20, abort)
      host.mouseButton('left', false)
    },

    async openInBrowser(input: OpenInBrowserInput, signal) {
      signal?.throwIfAborted()
      ;(await use()).launch(input.url ?? 'https://')
    },

    async openInFinder(input: OpenInFinderInput, signal) {
      signal?.throwIfAborted()
      const host = await use()
      if (input.revealOnly) host.launch('explorer.exe', `/select,"${input.path}"`)
      else host.launch(input.path)
    },

    async copyImageToClipboard(input: CopyImageToClipboardInput, signal) {
      signal?.throwIfAborted()
      ;(await use()).copyImageFile(input.path)
    },
  }
}
