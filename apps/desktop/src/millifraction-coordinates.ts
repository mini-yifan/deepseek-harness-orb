/** Persist overlay Computer Use millifraction-default enablement in the Desktop profile. */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Profile-relative JSON file holding the millifraction-coordinates default. */
export const MILLIFRACTION_COORDINATES_FILE = 'millifraction-coordinates.json'

/** Stored millifraction-coordinates default for new overlay Computer Use sessions. */
export interface MillifractionCoordinatesConfig {
  readonly enabled: boolean
}

const DEFAULT_CONFIG: MillifractionCoordinatesConfig = {
  enabled: false,
}

/**
 * Read the millifraction-coordinates default.
 * @param profileDir - Desktop profile directory.
 * @returns stored values, or the shipped default when absent or invalid.
 */
export function readMillifractionCoordinates(profileDir: string): MillifractionCoordinatesConfig {
  try {
    const value: unknown = JSON.parse(readFileSync(join(profileDir, MILLIFRACTION_COORDINATES_FILE), 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_CONFIG
    const record = value as { enabled?: unknown }
    return {
      enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_CONFIG.enabled,
    }
  } catch {
    // Missing or invalid profile JSON uses shipped defaults.
    return DEFAULT_CONFIG
  }
}

/**
 * Persist the millifraction-coordinates default.
 * @param profileDir - Desktop profile directory.
 * @param config - values to write.
 */
export function writeMillifractionCoordinates(
  profileDir: string,
  config: MillifractionCoordinatesConfig,
): void {
  writeFileSync(
    join(profileDir, MILLIFRACTION_COORDINATES_FILE),
    `${JSON.stringify({ enabled: config.enabled }, undefined, 2)}\n`,
  )
}

/** Overlay Computer Use click encoding derived from the millifraction default. */
export type OrbCoordinateMode = 'millifraction' | 'pixel'

/**
 * Host encoding that matches a stored millifraction default.
 * @param enabled - whether new overlay chats use 0–1000 millifraction.
 * @returns millifraction when enabled, otherwise pixel.
 */
export function orbCoordinateModeFor(enabled: boolean): OrbCoordinateMode {
  return enabled ? 'millifraction' : 'pixel'
}
