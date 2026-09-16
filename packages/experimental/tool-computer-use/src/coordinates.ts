/**
 * 0–1000 coordinate mapping and screenshot-hotkey rejection for Computer Use.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/coordinates
 */

import type { ScreenInfo } from './backend.ts'

/** Inclusive upper bound of the model-facing coordinate space on each axis. */
export const COORDINATE_SPACE = 1000

const META_KEYS = new Set(['cmd', 'command', 'meta', 'win', 'windows', 'super'])
const SHIFT_KEYS = new Set(['shift'])
const SCREENSHOT_KEYS = new Set(['3', '4', '5'])

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
  return {
    x: screen.bounds.x + (nx / COORDINATE_SPACE) * screen.bounds.width,
    y: screen.bounds.y + (ny / COORDINATE_SPACE) * screen.bounds.height,
  }
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
