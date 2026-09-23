/**
 * Windows desktop capture (GDI) and HID input (`SendInput`).
 * Observation bounds, capture, and pointer input share physical pixels.
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
import { activeCaptureExcludeWindowIds } from './capture-exclude.ts'
import { mapNormalizedToGlobal } from './coordinates.ts'
import { delay } from './wait.ts'
import {
  selectWindowsObservation,
  type WindowsDesktopSnapshot,
  type WindowsObservationSelection,
} from './windows-foreground.ts'

/** Logical screen rectangle in virtual-screen pixels. */
export interface WindowsRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Host operations behind the Windows backend.
 * Production uses Win32. Tests supply fakes.
 * `listWindows` returns physical pixels. Capture and pointer input use that same space.
 */
export interface WindowsDesktopOps {
  /** Z-order snapshot in physical pixels, including the foreground hwnd. */
  listWindows(): WindowsDesktopSnapshot
  capturePng(bounds: WindowsRect): Uint8Array
  /** True when the foreground window is elevated above this process (UIPI). */
  targetBlocksInput(): boolean
  movePointer(x: number, y: number): void
  mouseButton(button: 'left' | 'right', down: boolean): void
  scrollWheel(x: number, y: number, delta: number): void
  /**
   * Post one key transition.
   * @param virtualKey - Win32 virtual-key code.
   * @param down - true for key down, false for key up.
   * @param extended - true for the extended navigation keys (`KEYEVENTF_EXTENDEDKEY`).
   */
  key(virtualKey: number, down: boolean, extended?: boolean): void
  readClipboardText(): string
  setClipboardText(text: string): void
  copyImageFile(path: string): void
  listWindowApps(): readonly string[]
  /**
   * Bring a running app forward.
   * @param name - process base name or a substring of the window title.
   * @returns false when no window matches `name`.
   * @throws when a window matches but does not become foreground.
   */
  activateApp(name: string): boolean
  launch(target: string, parameters?: string): void
  /**
   * Explorer address path for one Explorer window.
   * @param hwnd - Explorer window handle.
   * @returns the folder path, or undefined when it cannot be read.
   */
  explorerFolder(hwnd: number): string | undefined
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
  insert: 0x2D,
}

/** Navigation keys whose scan code is the extended set. Numpad names are not in this map. */
const EXTENDED_KEY_NAMES = new Set([
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'insert',
  'delete',
  'del',
])

const MODIFIER_VKS = new Set([0x10, 0x11, 0x12, 0x5B, 0x5C])

/** Same settle the macOS HID script uses after a move, before the button goes down. */
const POINTER_MOVE_SETTLE_MS = 80
const BUTTON_HOLD_MS = 50
const DOUBLE_CLICK_GAP_MS = 100
const DRAG_STEPS = 10
const DRAG_STEP_MS = 20
const SCROLL_NOTCH = 120
const SCROLL_STEP_MS = 20
const MODIFIER_GAP_MS = 20
const CLIPBOARD_SETTLE_MS = 30
/** Wait after Ctrl+V before restoring the clipboard, so the target reads the pasted text. */
const PASTE_SETTLE_MS = 80

interface PostedKey {
  readonly vk: number
  readonly extended: boolean
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
 * Whether a hotkey token needs `KEYEVENTF_EXTENDEDKEY`.
 * @param key - model-supplied key name.
 * @returns true for arrows, editing, and navigation keys. Letters and digits return false.
 */
export function windowsKeyIsExtended(key: string): boolean {
  return EXTENDED_KEY_NAMES.has(key.trim().toLowerCase())
}

function postedKey(key: string): PostedKey {
  return { vk: windowsVirtualKey(key), extended: windowsKeyIsExtended(key) }
}

function postedVk(vk: number): PostedKey {
  return { vk, extended: false }
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
  await delay(POINTER_MOVE_SETTLE_MS, signal)
  for (let index = 0; index < count; index += 1) {
    ops.mouseButton(button, true)
    await delay(BUTTON_HOLD_MS, signal)
    ops.mouseButton(button, false)
    if (index + 1 < count) await delay(DOUBLE_CLICK_GAP_MS, signal)
  }
}

async function chord(
  ops: WindowsDesktopOps,
  keys: readonly PostedKey[],
  signal: AbortSignal,
): Promise<void> {
  const modifiers = keys.filter(key => MODIFIER_VKS.has(key.vk))
  const rest = keys.filter(key => !MODIFIER_VKS.has(key.vk))
  for (const key of modifiers) ops.key(key.vk, true, key.extended)
  if (modifiers.length > 0) await delay(MODIFIER_GAP_MS, signal)
  for (const key of rest) ops.key(key.vk, true, key.extended)
  for (const key of [...rest].reverse()) ops.key(key.vk, false, key.extended)
  for (const key of [...modifiers].reverse()) ops.key(key.vk, false, key.extended)
}

function observationOf(ops: WindowsDesktopOps): WindowsObservationSelection | undefined {
  return selectWindowsObservation(ops.listWindows(), activeCaptureExcludeWindowIds())
}

function screenFromObservation(selected: WindowsObservationSelection): ScreenInfo {
  return {
    index: 0,
    bounds: selected.bounds,
    scale: selected.scale,
    windowId: selected.windowId,
    ...selected.transientWindowIds.length === 0 ? {} : { transientWindowIds: selected.transientWindowIds },
  }
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
      const selected = observationOf(await use())
      if (selected === undefined) return []
      return [screenFromObservation(selected)]
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
      const host = await use()
      const selected = observationOf(host)
      if (selected === undefined) return FOCUS_FALLBACK_FOREGROUND
      const folder = selected.appName.toLowerCase() === 'explorer'
        ? host.explorerFolder(selected.windowId)
        : undefined
      const foreground: DesktopForeground = {
        appName: selected.appName,
        ...selected.windowTitle === '' ? {} : { windowTitle: selected.windowTitle },
        ...folder === undefined ? {} : { finderFolder: folder },
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
      if (input.replace) await chord(host, [postedVk(0x11), postedVk(0x41)], abort)
      const previous = host.readClipboardText()
      try {
        host.setClipboardText(input.text)
        await delay(CLIPBOARD_SETTLE_MS, abort)
        await chord(host, [postedVk(0x11), postedVk(0x56)], abort)
        await delay(PASTE_SETTLE_MS, abort)
        if (input.submit) {
          await delay(CLIPBOARD_SETTLE_MS, abort)
          await chord(host, [postedVk(0x0D)], abort)
        }
      } finally {
        host.setClipboardText(previous)
      }
    },

    async scroll(input: ScrollInput, signal) {
      const host = await use()
      assertInput(host)
      const point = pointOf(input.position, input.screen)
      const abort = liveSignal(signal)
      const step = (input.direction === 'up' ? 1 : -1) * SCROLL_NOTCH
      for (let index = 0; index < input.scrollLevel; index += 1) {
        host.scrollWheel(point.x, point.y, step)
        await delay(SCROLL_STEP_MS, abort)
      }
    },

    async hotkey(input: HotkeyInput, signal) {
      signal?.throwIfAborted()
      const host = await use()
      assertInput(host)
      await chord(host, input.keys.map(postedKey), liveSignal(signal))
    },

    async longPress(input: LongPressInput, signal) {
      const host = await use()
      assertInput(host)
      const point = pointOf(input.position, input.screen)
      const abort = liveSignal(signal)
      host.movePointer(point.x, point.y)
      await delay(POINTER_MOVE_SETTLE_MS, abort)
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
      await delay(POINTER_MOVE_SETTLE_MS, abort)
      host.mouseButton('left', true)
      await delay(BUTTON_HOLD_MS, abort)
      for (let step = 1; step <= DRAG_STEPS; step += 1) {
        const t = step / DRAG_STEPS
        host.movePointer(
          Math.round(start.x + (end.x - start.x) * t),
          Math.round(start.y + (end.y - start.y) * t),
        )
        await delay(DRAG_STEP_MS, abort)
      }
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
