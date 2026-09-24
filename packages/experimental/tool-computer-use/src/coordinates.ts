/**
 * Screenshot-fraction mapping, millifraction/pixel validation, click-modifier allowlist, and screenshot-hotkey rejection.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/coordinates
 */

import type { ScreenInfo } from './backend.ts'
import type { CoordinateMode, ObservationRaster } from './coordinate-mode.ts'

/** Inclusive upper bound of the millifraction click space on each axis. */
export const COORDINATE_SPACE = 1000

const META_KEYS = new Set(['cmd', 'command', 'meta', 'win', 'windows', 'super'])
const SHIFT_KEYS = new Set(['shift'])
const SCREENSHOT_KEYS = new Set(['3', '4', '5'])

/** Canonical modifier family for one click-modifier token. */
type ClickModifierKind = 'shift' | 'cmd' | 'option' | 'control'

const CLICK_MODIFIER_KIND: Readonly<Record<string, ClickModifierKind>> = {
  shift: 'shift',
  cmd: 'cmd',
  command: 'cmd',
  meta: 'cmd',
  win: 'cmd',
  windows: 'cmd',
  super: 'cmd',
  option: 'option',
  alt: 'option',
  control: 'control',
  ctrl: 'control',
}

/**
 * Normalize one hotkey token for comparison.
 * @param key - model-supplied key name.
 * @returns the trimmed lowercase token.
 */
export function normalizeHotkeyKey(key: string): string {
  return key.trim().toLowerCase()
}

/**
 * Whether a chord is a system screenshot shortcut (Cmd/Win+Shift+3/4/5).
 * @param keys - model-supplied hotkey tokens.
 * @returns true when the chord must be rejected.
 */
export function isForbiddenScreenshotHotkey(keys: readonly string[]): boolean {
  const normalized = keys.map(normalizeHotkeyKey).filter(key => key.length > 0)
  const hasMeta = normalized.some(key => META_KEYS.has(key))
  const hasShift = normalized.some(key => SHIFT_KEYS.has(key))
  const hasShot = normalized.some(key => SCREENSHOT_KEYS.has(key))
  return hasMeta && hasShift && hasShot
}

/**
 * Reject a screenshot chord before any desktop input is posted.
 * @param keys - model-supplied hotkey tokens.
 * @throws when the chord is a forbidden system screenshot shortcut.
 */
export function assertAllowedHotkey(keys: readonly string[]): void {
  if (isForbiddenScreenshotHotkey(keys)) {
    throw new Error('computer-use: system screenshot shortcuts are forbidden')
  }
}

/**
 * Accept omitted or empty `modifiers`, or a list of shift/cmd/option/control tokens.
 * Duplicate families keep the first token. Unknown keys, including letters and `fn`, are rejected.
 * @param modifiers - model-supplied click modifier tokens.
 * @returns normalized tokens to hold for this click, or `undefined` for a plain click.
 * @throws when a token is not a click modifier.
 */
export function requireClickModifiers(
  modifiers: readonly string[] | undefined,
): string[] | undefined {
  if (modifiers === undefined || modifiers.length === 0) return undefined
  const seen = new Set<ClickModifierKind>()
  const accepted: string[] = []
  for (const token of modifiers) {
    const key = normalizeHotkeyKey(token)
    const kind = CLICK_MODIFIER_KIND[key]
    if (kind === undefined) {
      throw new Error(
        `computer-use: click modifiers must be shift, cmd, option, or control; got ${JSON.stringify(token)}`,
      )
    }
    if (seen.has(kind)) continue
    seen.add(kind)
    accepted.push(key)
  }
  return accepted
}

/**
 * Map a 0–1 screenshot fraction onto one observation surface's logical global coordinates.
 * @param fraction - `[x, y]` each in `[0, 1]`, already divided by 1000 or attached size.
 * @param screen - observation whose logical bounds receive the mapping.
 * @returns global logical coordinates in the same space as `screen.bounds`.
 */
export function mapFractionToGlobal(
  fraction: readonly [number, number],
  screen: ScreenInfo,
): { x: number; y: number } {
  const [fx, fy] = fraction
  return {
    x: screen.bounds.x + fx * screen.bounds.width,
    y: screen.bounds.y + fy * screen.bounds.height,
  }
}

/**
 * Map a 0–1000 position onto one observation surface's logical global coordinates.
 * @param position - `[x, y]` in the 0–1000 space of `screen`.
 * @param screen - observation whose logical bounds receive the mapping.
 * @returns global logical coordinates in the same space as `screen.bounds`.
 */
export function mapNormalizedToGlobal(
  position: readonly [number, number],
  screen: ScreenInfo,
): { x: number; y: number } {
  const [nx, ny] = position
  return mapFractionToGlobal([nx / COORDINATE_SPACE, ny / COORDINATE_SPACE], screen)
}

/**
 * Map attached-raster pixels onto one observation surface's logical global coordinates.
 * @param position - `[x, y]` in the attached image's pixel space.
 * @param attached - width/height of the observation the model is looking at.
 * @param screen - observation whose logical bounds receive the mapping.
 * @returns global logical coordinates in the same space as `screen.bounds`.
 */
export function mapPixelToGlobal(
  position: readonly [number, number],
  attached: ObservationRaster,
  screen: ScreenInfo,
): { x: number; y: number } {
  const [x, y] = position
  return mapFractionToGlobal([x / attached.width, y / attached.height], screen)
}

/**
 * Require a two-number 0–1000 position.
 * @param position - tool argument array.
 * @returns the validated `[x, y]` pair.
 * @throws when the array is not two finite coordinates in 0–1000.
 */
export function requireNormalizedPosition(position: readonly number[]): [number, number] {
  if (position.length !== 2) {
    throw new Error('position must be [x, y] with exactly two coordinates in the 0–1000 space')
  }
  const x = position[0]
  const y = position[1]
  if (x === undefined || y === undefined
    || !Number.isFinite(x) || !Number.isFinite(y)
    || x < 0 || x > COORDINATE_SPACE
    || y < 0 || y > COORDINATE_SPACE) {
    throw new Error('position coordinates must be finite numbers in the 0–1000 space')
  }
  return [x, y]
}

/**
 * Require a two-number pixel position inside an attached raster, inclusive of the far edge.
 * @param position - tool argument array.
 * @param attached - width/height of the observation the model is looking at.
 * @returns the validated `[x, y]` pair.
 * @throws when the array is not two finite coordinates in that raster.
 */
export function requirePixelPosition(
  position: readonly number[],
  attached: ObservationRaster,
): [number, number] {
  if (position.length !== 2) {
    throw new Error(
      `position must be [x, y] with exactly two coordinates in the attached ${String(attached.width)}x${String(attached.height)} pixel space`,
    )
  }
  const x = position[0]
  const y = position[1]
  if (x === undefined || y === undefined
    || !Number.isFinite(x) || !Number.isFinite(y)
    || x < 0 || x > attached.width
    || y < 0 || y > attached.height) {
    throw new Error(
      `position coordinates must be finite numbers in the attached ${String(attached.width)}x${String(attached.height)} pixel space`,
    )
  }
  return [x, y]
}

/**
 * Validate a model `position` for this session's encoding and convert it to HID millifraction.
 * Pixel mode divides by the attached raster; millifraction keeps 0–1000. HID still posts 0–1000.
 * @param position - tool argument array.
 * @param mode - session contract.
 * @param attached - required when `mode` is pixel.
 * @returns `[x, y]` in the 0–1000 space `mapNormalizedToGlobal` consumes.
 * @throws when the encoding is pixel and no raster is attached, or the pair is out of range.
 */
export function modelPositionToHid(
  position: readonly number[],
  mode: CoordinateMode,
  attached: ObservationRaster | undefined,
): [number, number] {
  if (mode === 'millifraction') return requireNormalizedPosition(position)
  if (attached === undefined) {
    throw new Error('computer-use: pixel coordinates require an attached screenshot raster')
  }
  const [x, y] = requirePixelPosition(position, attached)
  return [(x / attached.width) * COORDINATE_SPACE, (y / attached.height) * COORDINATE_SPACE]
}
