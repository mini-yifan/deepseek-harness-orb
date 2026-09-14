/**
 * macOS desktop capture (`screencapture`) and HID input (JXA `CGEvent`).
 * JXA stringifies CoreGraphics enum constants and cannot pass a `UniChar *`,
 * so mouse/hotkey/scroll use numeric event types with a retained event source
 * and intra-event sleeps, and `input_text` pastes via NSPasteboard + Cmd+V.
 * Tests inject a {@link CommandRunner}; production uses `/usr/bin/osascript`
 * and `/usr/sbin/screencapture`, or the ScreenCaptureKit helper when overlay
 * window ids are active.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/macos
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { activeCaptureExcludeWindowIds } from './capture-exclude.ts'
import type {
  CapturedScreen,
  ClickInput,
  DesktopBackend,
  HotkeyInput,
  ScreenInfo,
  ScrollInput,
  TypeInput,
} from './backend.ts'
import { mapNormalizedToGlobal } from './coordinates.ts'

const execFileAsync = promisify(execFile)

/** Result of one injected or production subprocess. */
export interface CommandResult {
  readonly stdout: string
  readonly stderr: string
}

/**
 * Run one host binary. Tests replace this; production uses `execFile`.
 * @param file - absolute executable path.
 * @param args - argv after the executable.
 * @param options - optional abort signal.
 */
export type CommandRunner = (
  file: string,
  args: readonly string[],
  options?: { signal?: AbortSignal | undefined },
) => Promise<CommandResult>

const SCREENCAPTURE = '/usr/sbin/screencapture'
const OSASCRIPT = '/usr/bin/osascript'

/**
 * Absolute path of the Darwin ScreenCaptureKit overlay-exclude helper.
 * The binary sits in `lib/` next to the bundled plugin; source tests resolve the same file.
 * @returns the helper executable path.
 */
export function macosSckCaptureHelperPath(): string {
  return fileURLToPath(new URL('../lib/macos-sck-capture', import.meta.url))
}

/** JXA that lists NSScreen frames converted to top-left Quartz coordinates. */
export const LIST_SCREENS_SCRIPT = `ObjC.import('AppKit')
const screens = $.NSScreen.screens.js
const primary = $.NSScreen.screens.objectAtIndex(0).frame
const primaryHeight = primary.size.height
const result = []
for (let i = 0; i < screens.length; i++) {
  const s = screens[i]
  const f = s.frame
  result.push({
    index: i,
    x: f.origin.x,
    y: primaryHeight - f.origin.y - f.size.height,
    width: f.size.width,
    height: f.size.height,
    scale: s.backingScaleFactor,
  })
}
JSON.stringify(result)
`

const KEY_CODES: Readonly<Record<string, number>> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11,
  q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, '1': 18, '2': 19, '3': 20,
  '4': 21, '6': 22, '5': 23, equal: 24, '=': 24, '9': 25, '7': 26,
  minus: 27, '-': 27, '8': 28, '0': 29, ']': 30, o: 31, u: 32, '[': 33,
  i: 34, p: 35, enter: 36, return: 36, l: 37, j: 38, quote: 39, "'": 39,
  k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45, m: 46, '.': 47,
  tab: 48, space: 49, '`': 50, backspace: 51, delete: 51, escape: 53, esc: 53,
  cmd: 55, command: 55, meta: 55, win: 55, windows: 55, super: 55,
  shift: 56, capslock: 57, option: 58, alt: 58, control: 59, ctrl: 59,
  fn: 63, f17: 64, f18: 79, f19: 80, f20: 90, f5: 96, f6: 97, f7: 98,
  f3: 99, f8: 100, f9: 101, f11: 103, f13: 105, f16: 106, f14: 107,
  f10: 109, f12: 111, f15: 113, home: 115, pageup: 116, end: 119,
  f2: 120, pagedown: 121, f1: 122, left: 123, right: 124, down: 125, up: 126,
}

/**
 * Run a host binary and surface stderr on failure.
 * @param file - absolute executable path.
 * @param args - argv after the executable.
 * @param options - optional abort signal.
 * @returns captured utf8 streams.
 */
export async function runCommand(
  file: string,
  args: readonly string[],
  options: { signal?: AbortSignal | undefined } = {},
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(file, [...args], {
      encoding: 'utf8',
      signal: options.signal,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (error: unknown) {
    throw new Error(`computer-use: ${file} failed: ${errorDetail(error)}`)
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function mediaTypeOf(data: Uint8Array): CapturedScreen['mediaType'] {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return 'image/png'
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg'
  }
  throw new Error('computer-use: capture produced an unsupported image')
}

function parseScreens(stdout: string): ScreenInfo[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout) as unknown
  } catch {
    throw new Error('computer-use: failed to list displays')
  }
  if (!Array.isArray(parsed)) throw new Error('computer-use: failed to list displays')
  return parsed.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error('computer-use: failed to list displays')
    }
    const row = entry as Record<string, unknown>
    const x = Number(row.x)
    const y = Number(row.y)
    const width = Number(row.width)
    const height = Number(row.height)
    const scale = Number(row.scale)
    if (![x, y, width, height, scale].every(Number.isFinite) || width <= 0 || height <= 0) {
      throw new Error('computer-use: failed to list displays')
    }
    return {
      index: typeof row.index === 'number' ? row.index : index,
      bounds: { x, y, width, height },
      scale,
    }
  })
}

function keyCode(token: string): number {
  const key = token.trim().toLowerCase()
  const code = KEY_CODES[key]
  if (code === undefined) throw new Error(`computer-use: unknown key "${token}"`)
  return code
}

function jxa(script: string): readonly string[] {
  return ['-l', 'JavaScript', '-e', script]
}

/**
 * Shared JXA posted for every HID action.
 * Numeric CGEvent types: JXA exposes kCG* enums as strings.
 * `input_text` pastes: JXA cannot pass a UniChar buffer to CGEventKeyboardSetUnicodeString,
 * and virtual keycode 0 is the "a" key, so a failed unicode override types "a".
 */
const HID_RUNTIME = `
ObjC.import('Cocoa')
const HID = 0
const SRC = $.CGEventSourceCreate(1)
const MOVE = 5
const LEFT_DOWN = 1
const LEFT_UP = 2
const RIGHT_DOWN = 3
const RIGHT_UP = 4
const LEFT = 0
const RIGHT = 1
const CLICK_STATE = 1
const FLAG_SHIFT = 0x00020000
const FLAG_CTRL = 0x00040000
const FLAG_ALT = 0x00080000
const FLAG_CMD = 0x00100000
const FLAG_FN = 0x00008000
const KEY_CMD = 55
const KEY_SHIFT = 56
const KEY_OPTION = 58
const KEY_CONTROL = 59
const KEY_FN = 63
const KEY_A = 0
const KEY_V = 9
const KEY_ENTER = 36
function sleep(ms) {
  $.NSThread.sleepForTimeInterval(ms / 1000)
}
function postMouse(type, x, y, button, clickState) {
  const event = $.CGEventCreateMouseEvent(SRC, type, $.CGPointMake(x, y), button)
  if (clickState) $.CGEventSetIntegerValueField(event, CLICK_STATE, clickState)
  $.CGEventPost(HID, event)
}
function clickAt(x, y, button, count) {
  const down = button === RIGHT ? RIGHT_DOWN : LEFT_DOWN
  const up = button === RIGHT ? RIGHT_UP : LEFT_UP
  postMouse(MOVE, x, y, button, 0)
  sleep(80)
  for (var i = 1; i <= count; i++) {
    postMouse(down, x, y, button, i)
    sleep(50)
    postMouse(up, x, y, button, i)
    if (i < count) sleep(100)
  }
}
function postKey(code, down, flags) {
  const event = $.CGEventCreateKeyboardEvent(SRC, code, down)
  $.CGEventSetFlags(event, flags)
  $.CGEventPost(HID, event)
}
function tapKey(code, flags) {
  postKey(code, true, flags)
  sleep(20)
  postKey(code, false, flags)
  sleep(15)
}
function chord(codes) {
  var flags = 0
  var mods = []
  var keys = []
  for (var i = 0; i < codes.length; i++) {
    var code = codes[i]
    if (code === KEY_CMD) { flags |= FLAG_CMD; mods.push(code) }
    else if (code === KEY_SHIFT) { flags |= FLAG_SHIFT; mods.push(code) }
    else if (code === KEY_OPTION) { flags |= FLAG_ALT; mods.push(code) }
    else if (code === KEY_CONTROL) { flags |= FLAG_CTRL; mods.push(code) }
    else if (code === KEY_FN) { flags |= FLAG_FN; mods.push(code) }
    else keys.push(code)
  }
  for (var m = 0; m < mods.length; m++) postKey(mods[m], true, flags)
  sleep(20)
  if (keys.length === 0) {
    for (var t = mods.length - 1; t >= 0; t--) postKey(mods[t], false, 0)
    return
  }
  for (var k = 0; k < keys.length; k++) tapKey(keys[k], flags)
  for (var r = mods.length - 1; r >= 0; r--) postKey(mods[r], false, 0)
  sleep(20)
}
function clipboardString() {
  var value = $.NSPasteboard.generalPasteboard.stringForType($.NSPasteboardTypeString)
  if (!value) return ''
  try {
    var unwrapped = ObjC.unwrap(value)
    return typeof unwrapped === 'string' ? unwrapped : ''
  } catch (error) {
    // Nil NSPasteboard string unwraps by throwing in JXA; treat as empty.
    return ''
  }
}
function clearPasteboard(pb) {
  // JXA invokes no-arg ObjC methods on property access; calling this as a JS
  // function would invoke the NSInteger return value.
  var discarded = pb.clearContents
}
function pasteText(text) {
  var pb = $.NSPasteboard.generalPasteboard
  var previous = clipboardString()
  clearPasteboard(pb)
  pb.setStringForType($.NSString.stringWithString(text), $.NSPasteboardTypeString)
  chord([KEY_CMD, KEY_V])
  sleep(80)
  clearPasteboard(pb)
  pb.setStringForType($.NSString.stringWithString(previous), $.NSPasteboardTypeString)
}
function selectAll() {
  chord([KEY_CMD, KEY_A])
}
function pressEnter() {
  tapKey(KEY_ENTER, 0)
}
function scrollAt(x, y, dy) {
  postMouse(MOVE, x, y, LEFT, 0)
  sleep(40)
  var step = dy < 0 ? -1 : 1
  var n = Math.abs(dy)
  if (n < 1) n = 1
  for (var i = 0; i < n; i++) {
    var event = $.CGEventCreateScrollWheelEvent2(SRC, 1, 1, step, 0, 0)
    $.CGEventSetLocation(event, $.CGPointMake(x, y))
    $.CGEventPost(HID, event)
    sleep(20)
  }
}
`.trim()

function hidScript(body: string): string {
  return `${HID_RUNTIME}\n${body}\n`
}

function roundedPoint(position: readonly [number, number], screen: ScreenInfo): { x: number; y: number } {
  const point = mapNormalizedToGlobal(position, screen)
  return { x: Math.round(point.x), y: Math.round(point.y) }
}

async function runHidScript(
  run: CommandRunner,
  script: string,
  signal?: AbortSignal,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-computer-use-hid-'))
  const file = join(dir, 'hid.js')
  try {
    await writeFile(file, script, 'utf8')
    await run(OSASCRIPT, ['-l', 'JavaScript', file], { signal })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Construct the production macOS backend, optionally with a test command runner.
 * @param run - subprocess runner; omitted uses {@link runCommand}.
 * @returns capture and HID input against the host desktop.
 */
export function createMacosDesktopBackend(run: CommandRunner = runCommand): DesktopBackend {
  const hid = async (body: string, signal?: AbortSignal): Promise<void> => {
    await runHidScript(run, hidScript(body), signal)
  }

  return {
    async listScreens(signal) {
      const result = await run(OSASCRIPT, jxa(LIST_SCREENS_SCRIPT), { signal })
      const screens = parseScreens(result.stdout.trim())
      if (screens.length === 0) throw new Error('computer-use: no displays available')
      return screens
    },

    async capture(screen, signal) {
      const dir = await mkdtemp(join(tmpdir(), 'dsh-computer-use-'))
      const file = join(dir, 'screen.jpg')
      const excludeWindowIds = activeCaptureExcludeWindowIds()
      try {
        const { x, y, width, height } = screen.bounds
        const rect = `${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)}`
        if (excludeWindowIds.length === 0) {
          await run(SCREENCAPTURE, ['-x', '-C', '-t', 'jpg', '-R', rect, file], { signal })
        } else {
          try {
            await run(macosSckCaptureHelperPath(), [
              `--rect=${rect}`,
              `--exclude=${excludeWindowIds.join(',')}`,
              `--out=${file}`,
            ], { signal })
          } catch (error: unknown) {
            throw new Error(`computer-use: overlay-exclude capture failed: ${errorDetail(error)}`)
          }
        }
        const data = await readFile(file)
        return { data, mediaType: mediaTypeOf(data) }
      } catch (error: unknown) {
        if (error instanceof Error && error.message.startsWith('computer-use: overlay-exclude capture failed:')) {
          throw error
        }
        throw new Error(
          `computer-use: screen capture failed (Screen Recording permission is required): ${errorDetail(error)}`,
        )
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },

    async click(input: ClickInput, signal) {
      const point = roundedPoint(input.position, input.screen)
      const button = input.button === 'right' ? 1 : 0
      try {
        await hid(`clickAt(${point.x}, ${point.y}, ${button}, ${input.count})`, signal)
      } catch (error: unknown) {
        throw new Error(
          `computer-use: pointer input failed (Accessibility permission is required): ${errorDetail(error)}`,
        )
      }
    },

    async typeText(input: TypeInput, signal) {
      const point = roundedPoint(input.position, input.screen)
      const lines = [`clickAt(${point.x}, ${point.y}, 0, 1)`, 'sleep(120)']
      if (input.replace) {
        lines.push('selectAll()', 'sleep(40)')
      }
      if (input.text.length > 0) {
        lines.push(`pasteText(${JSON.stringify(input.text)})`)
      }
      if (input.submit) {
        lines.push('pressEnter()')
      }
      try {
        await hid(lines.join('\n'), signal)
      } catch (error: unknown) {
        throw new Error(
          `computer-use: keyboard input failed (Accessibility permission is required): ${errorDetail(error)}`,
        )
      }
    },

    async scroll(input: ScrollInput, signal) {
      const point = roundedPoint(input.position, input.screen)
      const dy = input.direction === 'up' ? input.scrollLevel : -input.scrollLevel
      try {
        await hid(`scrollAt(${point.x}, ${point.y}, ${dy})`, signal)
      } catch (error: unknown) {
        throw new Error(
          `computer-use: scroll input failed (Accessibility permission is required): ${errorDetail(error)}`,
        )
      }
    },

    async hotkey(input: HotkeyInput, signal) {
      try {
        const codes = input.keys.map(keyCode)
        await hid(`chord(${JSON.stringify(codes)})`, signal)
      } catch (error: unknown) {
        if (error instanceof Error && error.message.startsWith('computer-use: unknown key')) throw error
        throw new Error(
          `computer-use: hotkey input failed (Accessibility permission is required): ${errorDetail(error)}`,
        )
      }
    },
  }
}

/**
 * Write bytes to a capture output path. Test command runners use this when they emulate `screencapture`.
 * @param file - destination path from the capture argv.
 * @param data - encoded image bytes.
 */
export async function writeCaptureFile(file: string, data: Uint8Array): Promise<void> {
  await writeFile(file, data)
}
