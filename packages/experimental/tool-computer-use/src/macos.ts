/**
 * macOS desktop capture (`screencapture`) and HID input (JXA `CGEvent`).
 * JXA stringifies CoreGraphics enum constants and cannot pass a `UniChar *`,
 * so mouse/hotkey/scroll use numeric event types with a retained event source
 * and intra-event sleeps, and `input_text` pastes via NSPasteboard + Cmd+V.
 * Tests inject a {@link CommandRunner}; production uses `/usr/bin/osascript`
 * and `/usr/sbin/screencapture` plus a `sips`-free `-R` region capture
 * of the frontmost-app window union. The region flag reads the rectangle from the
 * display that owns it at that display's pixel scale, so secondary displays and
 * mixed DPI keep working, and the capture rectangle, the attached raster, and the
 * 0–1000 click mapping all describe the same rounded pixels (`-C` bakes the system
 * cursor into the image). The ScreenCaptureKit overlay-exclude path runs when
 * overlay window ids are active. Desktop Host calls `captureExcludedRegion`
 * so ScreenCaptureKit runs in the Electron process; CLI still spawns `macos-sck-capture`.
 * Foreground inspect uses
 * CGWindowList (skip overlay ids only) plus Finder AppleScript for the current
 * folder. JXA does not bridge `CGWindowListCopyWindowInfo` to `NSArray` unless
 * `ObjC.bindFunction` declares the return type as `id`; without that bind,
 * `ObjC.deepUnwrap` is a non-array and the walk finds no window. `list_apps` /
 * `open_app` use NSWorkspace. `open_in_browser` and
 * `open_in_finder` use `/usr/bin/open`. `screenshot` writes Desktop files in Node
 * and copies the image through NSPasteboard.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/macos
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { activeCaptureExcludeWindowIds } from './capture-exclude.ts'
import { CROSS_PID_TRANSIENT_PAD, MIN_LAYER0_WINDOW_EDGE } from './observation-limits.ts'
import {
  FOCUS_FALLBACK_FOREGROUND,
  type CapturedScreen,
  type ClickInput,
  type CopyImageToClipboardInput,
  type DesktopBackend,
  type DesktopForeground,
  type DragInput,
  type HotkeyInput,
  type LongPressInput,
  type OpenAppInput,
  type OpenAppResult,
  type OpenInBrowserInput,
  type OpenInFinderInput,
  type ScreenInfo,
  type ScrollInput,
  type TypeInput,
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
const OPEN = '/usr/bin/open'

/**
 * Absolute path of the Darwin ScreenCaptureKit overlay-exclude helper.
 * The binary sits in `lib/` next to the bundled plugin; source tests resolve the same file.
 * @returns the helper executable path.
 */
export function macosSckCaptureHelperPath(): string {
  return fileURLToPath(new URL('../lib/macos-sck-capture', import.meta.url))
}

/**
 * Overlay-exclude ScreenCaptureKit JPEG capture. Desktop Host implements this over IPC.
 * @param input - region `x,y,w,h`, overlay window ids, JPEG path, and optional abort.
 */
export type OverlayExcludedRegionCapture = (input: {
  readonly region: string
  readonly excludeWindowIds: readonly number[]
  readonly output: string
  readonly signal?: AbortSignal
}) => Promise<void>

/** JXA that lists localized names of running regular applications. */
export const LIST_APPS_SCRIPT = `ObjC.import('AppKit')
const apps = $.NSWorkspace.sharedWorkspace.runningApplications.js
const names = []
const seen = {}
for (var i = 0; i < apps.length; i++) {
  var app = apps[i]
  if (app.activationPolicy !== 0) continue
  var name = ObjC.unwrap(app.localizedName)
  if (typeof name !== 'string') continue
  name = name.trim()
  if (name.length === 0 || seen[name]) continue
  seen[name] = true
  names.push(name)
}
JSON.stringify(names)
`

/** AppleScript that returns Finder's front-window folder POSIX path, or empty. */
export const FINDER_FOLDER_SCRIPT = `tell application "Finder"
    try
        return POSIX path of (target of front window as alias)
    on error
        return ""
    end try
end tell
`

/** JXA that prints the default https handler bundle id, or null. */
export const DEFAULT_BROWSER_SCRIPT = `ObjC.import('AppKit')
const url = $.NSURL.URLWithString('https:')
const appUrl = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(url)
if (!appUrl) {
  JSON.stringify(null)
} else {
  const id = $.NSBundle.bundleWithURL(appUrl).bundleIdentifier
  const unwrapped = id ? ObjC.unwrap(id) : ''
  JSON.stringify(typeof unwrapped === 'string' && unwrapped.length > 0 ? unwrapped : null)
}
`

/**
 * Keep only positive integers so interpolated JXA cannot carry hostile tokens.
 * @param excludeWindowIds - overlay CGWindowIDs from the active capture cloak.
 * @returns ids safe to embed as JXA object keys.
 */
export function sanitizeExcludeWindowIds(excludeWindowIds: readonly number[]): number[] {
  return excludeWindowIds.filter(id => Number.isInteger(id) && id > 0)
}

export { CROSS_PID_TRANSIENT_PAD, MIN_LAYER0_WINDOW_EDGE }

/**
 * Popup-menu layer included from an unrelated PID when it intersects the owner window.
 * 101 is `kCGPopUpMenuWindowLevel` (NSPopUpButton / NSMenu on this host).
 */
export const CROSS_PID_TRANSIENT_LAYERS = [101] as const

/** Dock and menu-bar layers omitted from observation. Status-item layer 25 is not chrome. */
export const CHROME_WINDOW_LAYERS = [20, 24] as const

/** Owner names that are never menus of the frontmost app. */
export const CHROME_WINDOW_OWNERS = [
  'Dock',
  '程序坞',
  'Control Center',
  '控制中心',
  'Notification Center',
  'Notification Centre',
  '通知中心',
  'Wallpaper',
  '墙纸',
] as const

function jxaKeySet(keys: readonly (number | string)[]): string {
  return `{ ${keys.map(key => `${JSON.stringify(key)}: true`).join(', ')} }`
}

/**
 * JXA that reports the first on-screen layer-0 window after skipping overlay ids.
 * Binds `CGWindowListCopyWindowInfo` as returning `id` so `ObjC.deepUnwrap` is an array.
 * Skips remaining windows with an edge below {@link MIN_LAYER0_WINDOW_EDGE}.
 * Then unions every same-screen window of that app family into `x`/`y`/`width`/`height`.
 * Family PIDs come from NSWorkspace: same process, related localized names, or bundle-id prefix.
 * Unrelated PIDs join only at layer 101 when they intersect the owner.
 * @param excludeWindowIds - overlay CGWindowIDs omitted from the remaining z-order.
 * @returns a script that prints window JSON or `null`.
 */
export function inspectForegroundScript(excludeWindowIds: readonly number[]): string {
  const ids = sanitizeExcludeWindowIds(excludeWindowIds)
  const excludeLiteral = ids.length === 0 ? '{}' : `{ ${ids.map(id => `${String(id)}: true`).join(', ')} }`
  return `ObjC.import('AppKit')
ObjC.import('CoreGraphics')
ObjC.bindFunction('CGWindowListCopyWindowInfo', ['@', ['I', 'I']])
const exclude = ${excludeLiteral}
const crossPidLayers = ${jxaKeySet(CROSS_PID_TRANSIENT_LAYERS)}
const chromeLayers = ${jxaKeySet(CHROME_WINDOW_LAYERS)}
const chromeOwners = ${jxaKeySet(CHROME_WINDOW_OWNERS)}
const pad = ${String(CROSS_PID_TRANSIENT_PAD)}
const windows = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(1, 0)) || []
const primary = $.NSScreen.screens.objectAtIndex(0).frame
const primaryHeight = primary.size.height
function screenAt(x, y, w, h) {
  var cx = x + w / 2
  var cy = y + h / 2
  var screens = $.NSScreen.screens.js
  for (var i = 0; i < screens.length; i++) {
    var f = screens[i].frame
    // AppKit frames use a bottom-left origin; window bounds and the screencapture
    // region flag share the main display's top-left origin, so flip the frame here.
    var sx = f.origin.x
    var sy = primaryHeight - f.origin.y - f.size.height
    if (cx >= sx && cx < sx + f.size.width && cy >= sy && cy < sy + f.size.height) {
      return {
        index: i,
        x: sx,
        y: sy,
        width: f.size.width,
        height: f.size.height,
        scale: Number(screens[i].backingScaleFactor),
      }
    }
  }
  return null
}
function screenIndex(x, y, w, h) {
  var screen = screenAt(x, y, w, h)
  return screen ? screen.index : -1
}
function screenScale(x, y, w, h) {
  var screen = screenAt(x, y, w, h)
  if (screen && screen.scale > 0) return screen.scale
  var main = $.NSScreen.mainScreen
  var fallback = main ? Number(main.backingScaleFactor) : 1
  return fallback > 0 ? fallback : 1
}
function overlaps(ax, ay, aw, ah, bx, by, bw, bh, extra) {
  return ax - extra < bx + bw && ax + aw + extra > bx
    && ay - extra < by + bh && ay + ah + extra > by
}
function relatedOwner(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) return false
  if (a === b) return true
  return b.indexOf(a + ' ') === 0 || a.indexOf(b + ' ') === 0
}
function relatedBundle(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) return false
  if (a === b) return true
  return b.indexOf(a + '.') === 0 || a.indexOf(b + '.') === 0
}
function familyPids(ownerPid) {
  var pids = {}
  pids[ownerPid] = true
  var apps = $.NSWorkspace.sharedWorkspace.runningApplications.js
  var loc = ''
  var bundle = ''
  for (var i = 0; i < apps.length; i++) {
    if (Number(apps[i].processIdentifier) === ownerPid) {
      loc = ObjC.unwrap(apps[i].localizedName)
      bundle = ObjC.unwrap(apps[i].bundleIdentifier)
      break
    }
  }
  if (typeof loc !== 'string') loc = ''
  if (typeof bundle !== 'string') bundle = ''
  for (var j = 0; j < apps.length; j++) {
    var app = apps[j]
    var pid = Number(app.processIdentifier)
    if (!(pid > 0) || pids[pid]) continue
    var n = ObjC.unwrap(app.localizedName)
    var b = ObjC.unwrap(app.bundleIdentifier)
    if (relatedOwner(loc, n) || relatedBundle(bundle, b)) pids[pid] = true
  }
  return pids
}
var found = null
var ownerPid = 0
var ownerScreen = -1
var minEdge = ${String(MIN_LAYER0_WINDOW_EDGE)}
for (var i = 0; i < windows.length; i++) {
  var w = windows[i]
  if (!w) continue
  var id = Number(w.kCGWindowNumber)
  if (!(id > 0) || exclude[id]) continue
  if (Number(w.kCGWindowLayer) !== 0) continue
  var name = w.kCGWindowOwnerName
  if (typeof name !== 'string' || name.length === 0) continue
  var b = w.kCGWindowBounds
  var x = b ? Number(b.X) : NaN
  var y = b ? Number(b.Y) : NaN
  var width = b ? Number(b.Width) : NaN
  var height = b ? Number(b.Height) : NaN
  var owner = screenAt(x, y, width, height)
  var scale = owner ? owner.scale : screenScale(x, y, width, height)
  if (!(width >= minEdge) || !(height >= minEdge) || !(scale > 0)) continue
  ownerPid = Number(w.kCGWindowOwnerPID)
  ownerScreen = owner ? owner.index : -1
  found = {
    appName: name,
    windowId: id,
    x: x,
    y: y,
    width: width,
    height: height,
    scale: scale,
  }
  // The owning display rect lets the caller clip the capture region the same way the
  // screencapture region flag does, so raster, ribbon, and click mapping stay one rectangle.
  if (owner) {
    found.screen = { x: owner.x, y: owner.y, width: owner.width, height: owner.height }
  }
  var title = w.kCGWindowName
  if (typeof title === 'string' && title.trim().length > 0) found.windowTitle = title.trim()
  break
}
if (found) {
  var family = familyPids(ownerPid)
  var transients = []
  var minX = found.x
  var minY = found.y
  var maxX = found.x + found.width
  var maxY = found.y + found.height
  for (var j = 0; j < windows.length; j++) {
    var t = windows[j]
    if (!t) continue
    var tid = Number(t.kCGWindowNumber)
    if (!(tid > 0) || exclude[tid] || tid === found.windowId) continue
    var tLayer = Number(t.kCGWindowLayer)
    if (chromeLayers[tLayer] || tLayer < 0) continue
    var tOwner = t.kCGWindowOwnerName
    if (typeof tOwner === 'string' && chromeOwners[tOwner]) continue
    var tb = t.kCGWindowBounds
    var tx = tb ? Number(tb.X) : NaN
    var ty = tb ? Number(tb.Y) : NaN
    var tw = tb ? Number(tb.Width) : NaN
    var th = tb ? Number(tb.Height) : NaN
    if (!(tw > 0) || !(th > 0) || Number(t.kCGWindowAlpha) === 0) continue
    if (screenIndex(tx, ty, tw, th) !== ownerScreen) continue
    var tPid = Number(t.kCGWindowOwnerPID)
    var inFamily = family[tPid] || relatedOwner(found.appName, tOwner)
    if (!inFamily) {
      if (!crossPidLayers[tLayer]) continue
      if (!overlaps(found.x, found.y, found.width, found.height, tx, ty, tw, th, pad)) continue
    }
    transients.push(tid)
    if (tx < minX) minX = tx
    if (ty < minY) minY = ty
    if (tx + tw > maxX) maxX = tx + tw
    if (ty + th > maxY) maxY = ty + th
  }
  found.x = minX
  found.y = minY
  found.width = maxX - minX
  found.height = maxY - minY
  if (transients.length > 0) found.transients = transients
}
JSON.stringify(found)
`
}

/**
 * JXA that activates a running regular app by display name or bundle id, or reports launch.
 * @param name - localized name or bundle identifier.
 * @returns a script that prints `{ kind, name }` or `{ kind: 'ambiguous', names }`.
 */
export function openAppScript(name: string): string {
  return `ObjC.import('AppKit')
const needle = ${JSON.stringify(name)}
const needleLower = needle.toLowerCase()
const apps = $.NSWorkspace.sharedWorkspace.runningApplications.js
const matches = []
const seen = {}
for (var i = 0; i < apps.length; i++) {
  var app = apps[i]
  if (app.activationPolicy !== 0) continue
  var localized = ObjC.unwrap(app.localizedName)
  var bundle = ObjC.unwrap(app.bundleIdentifier)
  var nameOk = typeof localized === 'string' && localized.trim().toLowerCase() === needleLower
  var bundleOk = typeof bundle === 'string' && bundle.trim().toLowerCase() === needleLower
  if (!nameOk && !bundleOk) continue
  var key = typeof bundle === 'string' && bundle.length > 0 ? bundle : ('name:' + String(localized))
  if (seen[key]) continue
  seen[key] = true
  matches.push({
    app: app,
    name: typeof localized === 'string' && localized.trim().length > 0 ? localized.trim() : needle,
  })
}
if (matches.length > 1) {
  JSON.stringify({ kind: 'ambiguous', names: matches.map(function (m) { return m.name }) })
} else if (matches.length === 1) {
  matches[0].app.activateWithOptions_(2)
  JSON.stringify({ kind: 'activated', name: matches[0].name })
} else {
  JSON.stringify({ kind: 'launch', name: needle })
}
`
}

/**
 * Whether a CGWindow owner name is Finder (English or 访达).
 * @param appName - `kCGWindowOwnerName` after overlay skip.
 * @returns true when Finder folder lookup should run.
 */
export function isFinderApp(appName: string): boolean {
  const name = appName.trim()
  return name === 'Finder' || name === '访达'
}

const KEY_CODES: Readonly<Record<string, number>> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11,
  q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, '1': 18, '2': 19, '3': 20,
  '4': 21, '6': 22, '5': 23, equal: 24, '=': 24, '9': 25, '7': 26,
  minus: 27, '-': 27, '8': 28, '0': 29, ']': 30, o: 31, u: 32, '[': 33,
  i: 34, p: 35, enter: 36, return: 36, l: 37, j: 38, quote: 39, "'": 39,
  k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45, m: 46, '.': 47,
  tab: 48, space: 49, '`': 50, backspace: 51, delete: 117, escape: 53, esc: 53,
  cmd: 55, command: 55, meta: 55, win: 55, windows: 55, super: 55,
  shift: 56, capslock: 57, option: 58, alt: 58, control: 59, ctrl: 59,
  fn: 63, f17: 64, f18: 79, f19: 80, f20: 90, f5: 96, f6: 97, f7: 98,
  f3: 99, f8: 100, f9: 101, f11: 103, f13: 105, f16: 106, f14: 107,
  f10: 109, f12: 111, f15: 113, home: 115, pageup: 116, f4: 118, end: 119,
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

interface ParsedFrontmost {
  readonly appName: string
  readonly windowTitle?: string
  readonly windowId?: number
  readonly bounds?: ScreenInfo['bounds']
  readonly scale?: number
  readonly transientWindowIds?: readonly number[]
  readonly displayBounds?: ScreenInfo['bounds']
}

function parseTransientIds(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids: number[] = []
  for (const entry of value) {
    const id = Number(entry)
    if (!Number.isInteger(id) || id < 1) continue
    ids.push(id)
  }
  return ids.length === 0 ? undefined : ids
}

function parseBounds(value: unknown): ScreenInfo['bounds'] | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const x = Number(row.x)
  const y = Number(row.y)
  const width = Number(row.width)
  const height = Number(row.height)
  if (![x, y, width, height].every(Number.isFinite) || !(width > 0) || !(height > 0)) return undefined
  return { x, y, width, height }
}

function parseFrontmost(stdout: string): ParsedFrontmost | undefined {
  const trimmed = stdout.trim()
  if (trimmed === '' || trimmed === 'null') return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const row = parsed as Record<string, unknown>
    if (typeof row.appName !== 'string') return undefined
    const appName = row.appName.trim()
    if (appName === '') return undefined
    const windowTitle = typeof row.windowTitle === 'string' ? row.windowTitle.trim() : ''
    const windowId = Number(row.windowId)
    const x = Number(row.x)
    const y = Number(row.y)
    const width = Number(row.width)
    const height = Number(row.height)
    const scale = Number(row.scale)
    const transientWindowIds = parseTransientIds(row.transients)
    const displayBounds = parseBounds(row.screen)
    const hasSurface = Number.isInteger(windowId)
      && windowId > 0
      && [x, y, width, height, scale].every(Number.isFinite)
      && width > 0
      && height > 0
      && scale > 0
    return {
      appName,
      ...windowTitle === '' ? {} : { windowTitle },
      ...hasSurface ? {
        windowId,
        bounds: { x, y, width, height },
        scale,
        ...transientWindowIds === undefined ? {} : { transientWindowIds },
        ...displayBounds === undefined ? {} : { displayBounds },
      } : {},
    }
  } catch {
    return undefined
  }
}

/**
 * Intersect one observed rectangle with the display that owns it.
 * The capture region flag drops the part of a region outside its display, so the reported
 * bounds must be that same visible rectangle; otherwise the 0–1000 click mapping, the
 * observation ribbon, and the attached raster would describe three rectangles.
 * @param bounds - window union in global logical points.
 * @param display - owning display frame, or `undefined` when JXA found no screen.
 * @returns the visible rectangle, or `undefined` when nothing is on that display.
 */
function clipToDisplay(
  bounds: ScreenInfo['bounds'],
  display: ScreenInfo['bounds'] | undefined,
): ScreenInfo['bounds'] | undefined {
  if (display === undefined) return bounds
  const x = Math.max(bounds.x, display.x)
  const y = Math.max(bounds.y, display.y)
  const right = Math.min(bounds.x + bounds.width, display.x + display.width)
  const bottom = Math.min(bounds.y + bounds.height, display.y + display.height)
  if (!(right > x) || !(bottom > y)) return undefined
  return { x, y, width: right - x, height: bottom - y }
}

function screenFromFrontmost(parsed: ParsedFrontmost): ScreenInfo | undefined {
  if (parsed.windowId === undefined || parsed.bounds === undefined || parsed.scale === undefined) {
    return undefined
  }
  const clipped = clipToDisplay(parsed.bounds, parsed.displayBounds)
  if (clipped === undefined) return undefined
  // The capture rectangle and the click mapping both divide by the raster this rounded
  // rectangle produces; they must describe the same pixels.
  return {
    index: 0,
    bounds: roundedRegion(clipped),
    scale: parsed.scale,
    windowId: parsed.windowId,
    ...parsed.transientWindowIds === undefined ? {} : { transientWindowIds: parsed.transientWindowIds },
  }
}

function foregroundFromFrontmost(parsed: ParsedFrontmost): DesktopForeground {
  return {
    appName: parsed.appName,
    ...parsed.windowTitle === undefined ? {} : { windowTitle: parsed.windowTitle },
  }
}

function parseFinderFolder(stdout: string): string | undefined {
  const path = stdout.trim()
  if (path === '' || !path.startsWith('/')) return undefined
  return path
}

function parseDefaultBrowserBundle(stdout: string): string | undefined {
  const trimmed = stdout.trim()
  if (trimmed === '') return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed !== 'string') return undefined
    const bundle = parsed.trim()
    return bundle === '' ? undefined : bundle
  } catch {
    return undefined
  }
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return error instanceof Error && error.name === 'AbortError'
}

function parseAppNames(stdout: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout) as unknown
  } catch {
    throw new Error('computer-use: failed to list apps')
  }
  if (!Array.isArray(parsed)) throw new Error('computer-use: failed to list apps')
  const names: string[] = []
  const seen = new Set<string>()
  for (const entry of parsed) {
    if (typeof entry !== 'string') throw new Error('computer-use: failed to list apps')
    const name = entry.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function looksLikeBundleId(name: string): boolean {
  return /^[A-Za-z0-9-]+\.[A-Za-z0-9.-]+$/u.test(name)
}

function parseOpenAppDecision(stdout: string): { kind: 'activated' | 'launch'; name: string } | { kind: 'ambiguous'; names: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.trim()) as unknown
  } catch {
    throw new Error('computer-use: open_app failed: unreadable activate result')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('computer-use: open_app failed: unreadable activate result')
  }
  const row = parsed as Record<string, unknown>
  if (row.kind === 'ambiguous') {
    const names = Array.isArray(row.names)
      ? row.names.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
      : []
    return { kind: 'ambiguous', names }
  }
  if ((row.kind === 'activated' || row.kind === 'launch') && typeof row.name === 'string' && row.name.trim() !== '') {
    return { kind: row.kind, name: row.name.trim() }
  }
  throw new Error('computer-use: open_app failed: unreadable activate result')
}

function regionCaptureSpec(bounds: ScreenInfo['bounds']): string {
  return `${String(bounds.x)},${String(bounds.y)},${String(bounds.width)},${String(bounds.height)}`
}

/**
 * The one rounded rectangle a surface is captured and clicked in. Rounding happens once here,
 * so the `screencapture` region flag, the raster it produces, and the 0–1000 click mapping
 * all agree.
 * @param bounds - observed rectangle, already clipped to its owning display.
 * @returns the rounded rectangle.
 */
function roundedRegion(bounds: ScreenInfo['bounds']): ScreenInfo['bounds'] {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  }
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
 * Drag posts LeftMouseDragged (6), not MouseMoved (5): the latter relocates the
 * cursor without delivering mouseDragged: to AppKit and Electron.
 * Click modifiers hold keys, set the same flags on mouse events, then release
 * in that script.
 * `input_text` pastes: JXA cannot pass a UniChar buffer to CGEventKeyboardSetUnicodeString,
 * and virtual keycode 0 is the "a" key, so a failed unicode override types "a".
 */
const HID_RUNTIME = `
ObjC.import('Cocoa')
const HID = 0
const SRC = $.CGEventSourceCreate(1)
const LEFT_DOWN = 1
const LEFT_UP = 2
const RIGHT_DOWN = 3
const RIGHT_UP = 4
const MOVE = 5
const LEFT_DRAGGED = 6
const LEFT = 0
const RIGHT = 1
const CLICK_STATE = 1
const FLAG_SHIFT = 0x00020000
const FLAG_CTRL = 0x00040000
const FLAG_ALT = 0x00080000
const FLAG_CMD = 0x00100000
// kCGEventFlagMaskSecondaryFn; 0x8000 is not an AppKit Fn flag.
const FLAG_FN = 0x00800000
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
function postMouse(type, x, y, button, clickState, flags) {
  const event = $.CGEventCreateMouseEvent(SRC, type, $.CGPointMake(x, y), button)
  if (clickState) $.CGEventSetIntegerValueField(event, CLICK_STATE, clickState)
  if (flags) $.CGEventSetFlags(event, flags)
  $.CGEventPost(HID, event)
}
function clickAt(x, y, button, count, flags) {
  flags = flags || 0
  const down = button === RIGHT ? RIGHT_DOWN : LEFT_DOWN
  const up = button === RIGHT ? RIGHT_UP : LEFT_UP
  postMouse(MOVE, x, y, button, 0, flags)
  sleep(80)
  for (var i = 1; i <= count; i++) {
    postMouse(down, x, y, button, i, flags)
    sleep(50)
    postMouse(up, x, y, button, i, flags)
    if (i < count) sleep(100)
  }
}
function clickWithModifiers(x, y, button, count, codes) {
  var flags = 0
  var mods = []
  for (var i = 0; i < codes.length; i++) {
    var code = codes[i]
    if (code === KEY_CMD) { flags |= FLAG_CMD; mods.push(code) }
    else if (code === KEY_SHIFT) { flags |= FLAG_SHIFT; mods.push(code) }
    else if (code === KEY_OPTION) { flags |= FLAG_ALT; mods.push(code) }
    else if (code === KEY_CONTROL) { flags |= FLAG_CTRL; mods.push(code) }
  }
  for (var m = 0; m < mods.length; m++) postKey(mods[m], true, flags)
  sleep(20)
  clickAt(x, y, button, count, flags)
  for (var r = mods.length - 1; r >= 0; r--) postKey(mods[r], false, heldFlags(mods, r))
  sleep(20)
}
function modifierFlag(code) {
  if (code === KEY_CMD) return FLAG_CMD
  if (code === KEY_SHIFT) return FLAG_SHIFT
  if (code === KEY_OPTION) return FLAG_ALT
  if (code === KEY_CONTROL) return FLAG_CTRL
  if (code === KEY_FN) return FLAG_FN
  return 0
}
// Flags that remain held once the modifiers above index upto are released: the last
// modifier to come up must report 0, an earlier one must keep reporting the rest.
function heldFlags(mods, upto) {
  var flags = 0
  for (var i = 0; i < upto; i++) flags |= modifierFlag(mods[i])
  return flags
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
    for (var t = mods.length - 1; t >= 0; t--) postKey(mods[t], false, heldFlags(mods, t))
    return
  }
  for (var k = 0; k < keys.length; k++) tapKey(keys[k], flags)
  for (var r = mods.length - 1; r >= 0; r--) postKey(mods[r], false, heldFlags(mods, r))
  sleep(20)
}
// Every type of every pasteboard item, kept as NSData in this process: saving only the
// string drops a copied image or file list, and the paste then destroys it.
function clipboardSnapshot(pb) {
  var items = []
  var entries = pb.pasteboardItems
  if (!entries) return items
  for (var i = 0; i < entries.count; i++) {
    var source = entries.objectAtIndex(i)
    var types = source.types
    var item = []
    for (var t = 0; t < types.count; t++) {
      var type = types.objectAtIndex(t)
      var data = source.dataForType(type)
      if (data) item.push({ type: type, data: data })
    }
    if (item.length > 0) items.push(item)
  }
  return items
}
function restoreClipboard(pb, items) {
  clearPasteboard(pb)
  for (var i = 0; i < items.length; i++) {
    var item = $.NSPasteboardItem.alloc.init
    for (var t = 0; t < items[i].length; t++) item.setDataForType(items[i][t].data, items[i][t].type)
    pb.writeObjects($([item]))
  }
}
function clearPasteboard(pb) {
  // JXA invokes no-arg ObjC methods on property access; calling this as a JS
  // function would invoke the NSInteger return value.
  var discarded = pb.clearContents
}
function pasteText(text) {
  var pb = $.NSPasteboard.generalPasteboard
  var previous = clipboardSnapshot(pb)
  clearPasteboard(pb)
  pb.setStringForType($.NSString.stringWithString(text), $.NSPasteboardTypeString)
  chord([KEY_CMD, KEY_V])
  sleep(80)
  restoreClipboard(pb, previous)
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
function longPressAt(x, y, durationMs) {
  postMouse(MOVE, x, y, LEFT, 0)
  sleep(80)
  postMouse(LEFT_DOWN, x, y, LEFT, 1)
  sleep(durationMs)
  postMouse(LEFT_UP, x, y, LEFT, 1)
}
function dragFromTo(x1, y1, x2, y2) {
  postMouse(MOVE, x1, y1, LEFT, 0)
  sleep(80)
  postMouse(LEFT_DOWN, x1, y1, LEFT, 1)
  sleep(50)
  var steps = 10
  for (var i = 1; i <= steps; i++) {
    var t = i / steps
    postMouse(LEFT_DRAGGED, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, LEFT, 1)
    sleep(20)
  }
  postMouse(LEFT_UP, x2, y2, LEFT, 1)
}
`.trim()

/**
 * Posted after a cancelled HID script: a killed osascript can stop between a press and its
 * release. Raises both mouse buttons at the current pointer position and every modifier;
 * an extra up on an already-raised key or button is a no-op.
 */
const HID_RELEASE_SCRIPT = `
ObjC.import('Cocoa')
const HID = 0
const SRC = $.CGEventSourceCreate(1)
const LEFT = 0
const RIGHT = 1
const LEFT_UP = 2
const RIGHT_UP = 4
const KEY_CMD = 55
const KEY_SHIFT = 56
const KEY_OPTION = 58
const KEY_CONTROL = 59
const KEY_FN = 63
function postMouseUp(type, point, button) {
  const event = $.CGEventCreateMouseEvent(SRC, type, point, button)
  $.CGEventPost(HID, event)
}
function postKeyUp(code) {
  const event = $.CGEventCreateKeyboardEvent(SRC, code, false)
  $.CGEventPost(HID, event)
}
const cursor = $.CGEventGetLocation($.CGEventCreate(SRC))
const here = $.CGPointMake(cursor.x, cursor.y)
postMouseUp(LEFT_UP, here, LEFT)
postMouseUp(RIGHT_UP, here, RIGHT)
postKeyUp(KEY_CMD)
postKeyUp(KEY_SHIFT)
postKeyUp(KEY_OPTION)
postKeyUp(KEY_CONTROL)
postKeyUp(KEY_FN)
`.trim()

function hidScript(body: string): string {
  return `${HID_RUNTIME}\n${body}\n`
}

const PASTEBOARD_TYPE: Record<CopyImageToClipboardInput['mediaType'], string> = {
  'image/png': 'public.png',
  'image/jpeg': 'public.jpeg',
  'image/gif': 'com.compuserve.gif',
  'image/webp': 'org.webmproject.webp',
}

function copyImageScript(input: CopyImageToClipboardInput): string {
  return `ObjC.import('AppKit')
var pb = $.NSPasteboard.generalPasteboard
var discarded = pb.clearContents
var data = $.NSData.dataWithContentsOfFile($.NSString.stringWithString(${JSON.stringify(input.path)}))
if (!data) throw new Error('clipboard image file is missing')
pb.setDataForType(data, $.NSString.stringWithString(${JSON.stringify(PASTEBOARD_TYPE[input.mediaType])}))
`
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
 * @param excludedRegionCapture - Desktop overlay-exclude capture; omitted spawns the CLI helper.
 * @returns capture and HID input against the host desktop.
 */
export function createMacosDesktopBackend(
  run: CommandRunner = runCommand,
  excludedRegionCapture?: OverlayExcludedRegionCapture,
): DesktopBackend {
  const hid = async (body: string, signal?: AbortSignal): Promise<void> => {
    try {
      await runHidScript(run, hidScript(body), signal)
    } catch (error: unknown) {
      // A cancelled script dies between a press and its release. The release runs without
      // the aborted signal so it cannot be killed by the same cancellation.
      if (isAbortError(error, signal)) await releaseHidInput()
      throw error
    }
  }

  async function releaseHidInput(): Promise<void> {
    try {
      await run(OSASCRIPT, jxa(HID_RELEASE_SCRIPT), {})
    } catch (error: unknown) {
      console.error(`computer-use: HID release failed: ${errorDetail(error)}`)
    }
  }

  return {
    withGuiTurn: run => run(),
    async listScreens(signal) {
      const result = await run(
        OSASCRIPT,
        jxa(inspectForegroundScript(activeCaptureExcludeWindowIds())),
        { signal },
      )
      const parsed = parseFrontmost(result.stdout)
      if (parsed === undefined) return []
      const screen = screenFromFrontmost(parsed)
      return screen === undefined ? [] : [screen]
    },

    async capture(screen, signal) {
      const dir = await mkdtemp(join(tmpdir(), 'dsh-computer-use-'))
      const file = join(dir, 'screen.jpg')
      const excludeWindowIds = activeCaptureExcludeWindowIds()
      const overlayCapture = async (region: string, ids: readonly number[]): Promise<void> => {
        try {
          if (excludedRegionCapture !== undefined) {
            await excludedRegionCapture({
              region,
              excludeWindowIds: ids,
              output: file,
              ...signal === undefined ? {} : { signal },
            })
            return
          }
          await run(macosSckCaptureHelperPath(), [
            `--region=${region}`,
            `--exclude=${ids.join(',')}`,
            `--out=${file}`,
          ], { signal })
        } catch (error: unknown) {
          throw new Error(`computer-use: overlay-exclude capture failed: ${errorDetail(error)}`)
        }
      }
      try {
        const region = regionCaptureSpec(screen.bounds)
        if (excludeWindowIds.length === 0) {
          // The region flag reads its rectangle from the display that owns it, at that display's
          // pixel scale, and `-C` bakes the system cursor into the image so the agent can see
          // where its clicks land. A bare `screencapture` would write the main display only,
          // so an observed window on a secondary display would come back as main-display pixels.
          await run(SCREENCAPTURE, ['-x', '-C', '-R', region, '-t', 'jpg', file], { signal })
        } else {
          await overlayCapture(region, excludeWindowIds)
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

    async inspectForeground(signal) {
      try {
        const result = await run(
          OSASCRIPT,
          jxa(inspectForegroundScript(activeCaptureExcludeWindowIds())),
          { signal },
        )
        const parsed = parseFrontmost(result.stdout)
        if (parsed === undefined) return FOCUS_FALLBACK_FOREGROUND
        const foreground = foregroundFromFrontmost(parsed)
        if (!isFinderApp(parsed.appName)) return foreground
        try {
          const folder = await run(OSASCRIPT, ['-e', FINDER_FOLDER_SCRIPT], { signal })
          const finderFolder = parseFinderFolder(folder.stdout)
          return finderFolder === undefined ? foreground : { ...foreground, finderFolder }
        } catch (error: unknown) {
          if (isAbortError(error, signal)) throw error
          return foreground
        }
      } catch (error: unknown) {
        if (isAbortError(error, signal)) throw error
        return FOCUS_FALLBACK_FOREGROUND
      }
    },

    async listApps(signal) {
      const result = await run(OSASCRIPT, jxa(LIST_APPS_SCRIPT), { signal })
      return parseAppNames(result.stdout.trim())
    },

    async openApp(input: OpenAppInput, signal): Promise<OpenAppResult> {
      const name = input.name.trim()
      if (name === '') throw new Error('computer-use: open_app requires a name')
      try {
        const result = await run(OSASCRIPT, jxa(openAppScript(name)), { signal })
        const decision = parseOpenAppDecision(result.stdout)
        if (decision.kind === 'ambiguous') {
          const listed = decision.names.length === 0 ? name : decision.names.join(', ')
          throw new Error(`computer-use: app name "${name}" matches multiple applications: ${listed}`)
        }
        if (decision.kind === 'activated') {
          return { kind: 'activated', name: decision.name }
        }
        await run(OPEN, looksLikeBundleId(name) ? ['-b', name] : ['-a', name], { signal })
        return { kind: 'launched', name }
      } catch (error: unknown) {
        if (error instanceof Error && error.message.startsWith('computer-use:')) throw error
        throw new Error(`computer-use: open_app failed for ${name}: ${errorDetail(error)}`)
      }
    },

    async click(input: ClickInput, signal) {
      const point = roundedPoint(input.position, input.screen)
      const button = input.button === 'right' ? 1 : 0
      const modifiers = input.modifiers ?? []
      const body = modifiers.length === 0
        ? `clickAt(${point.x}, ${point.y}, ${button}, ${input.count})`
        : `clickWithModifiers(${point.x}, ${point.y}, ${button}, ${input.count}, ${JSON.stringify(modifiers.map(keyCode))})`
      try {
        await hid(body, signal)
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

    async longPress(input: LongPressInput, signal) {
      const point = roundedPoint(input.position, input.screen)
      const durationMs = Math.round(input.durationSeconds * 1000)
      try {
        await hid(`longPressAt(${point.x}, ${point.y}, ${String(durationMs)})`, signal)
      } catch (error: unknown) {
        throw new Error(
          `computer-use: pointer input failed (Accessibility permission is required): ${errorDetail(error)}`,
        )
      }
    },

    async drag(input: DragInput, signal) {
      const start = roundedPoint(input.startPosition, input.startScreen)
      const end = roundedPoint(input.endPosition, input.endScreen)
      try {
        await hid(`dragFromTo(${start.x}, ${start.y}, ${end.x}, ${end.y})`, signal)
      } catch (error: unknown) {
        throw new Error(
          `computer-use: pointer input failed (Accessibility permission is required): ${errorDetail(error)}`,
        )
      }
    },

    async openInBrowser(input: OpenInBrowserInput, signal) {
      try {
        if (input.url !== undefined) {
          await run(OPEN, [input.url], { signal })
          return
        }
        const result = await run(OSASCRIPT, jxa(DEFAULT_BROWSER_SCRIPT), { signal })
        const bundle = parseDefaultBrowserBundle(result.stdout)
        if (bundle === undefined) {
          throw new Error('could not resolve the default browser')
        }
        await run(OPEN, ['-b', bundle], { signal })
      } catch (error: unknown) {
        const target = input.url === undefined ? 'the default browser' : input.url
        throw new Error(`computer-use: open failed for ${target}: ${errorDetail(error)}`)
      }
    },

    async openInFinder(input: OpenInFinderInput, signal) {
      try {
        await run(OPEN, input.revealOnly ? ['-R', input.path] : [input.path], { signal })
      } catch (error: unknown) {
        throw new Error(`computer-use: open failed for ${input.path}: ${errorDetail(error)}`)
      }
    },

    async copyImageToClipboard(input: CopyImageToClipboardInput, signal) {
      try {
        await runHidScript(run, copyImageScript(input), signal)
      } catch (error: unknown) {
        throw new Error(`computer-use: clipboard copy failed: ${errorDetail(error)}`)
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
