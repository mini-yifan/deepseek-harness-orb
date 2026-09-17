/** Persist the floating-ball Access preset for overlay Computer Use and background `code_agent`. */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Profile-relative JSON file holding the overlay Access preset. */
export const ORB_PERMISSION_FILE = 'orb-permission.json'

/** Access presets the overlay chip can persist and apply. */
export const ORB_PERMISSION_PRESETS = ['read-only', 'workspace-write', 'danger-full-access'] as const

/** One overlay Access preset id. */
export type OrbPermissionPreset = (typeof ORB_PERMISSION_PRESETS)[number]

/** Shipped overlay Access: Full access. */
export const DEFAULT_ORB_PERMISSION: OrbPermissionPreset = 'danger-full-access'

/**
 * True when `value` is one of {@link ORB_PERMISSION_PRESETS}.
 * @param value - unknown JSON or IPC payload.
 * @returns whether `value` may be stored or applied.
 */
export function isOrbPermissionPreset(value: unknown): value is OrbPermissionPreset {
  return typeof value === 'string'
    && (ORB_PERMISSION_PRESETS as readonly string[]).includes(value)
}

/**
 * Read the overlay Access preset.
 * @param profileDir - Desktop profile directory.
 * @returns the stored preset, or {@link DEFAULT_ORB_PERMISSION} when absent or invalid.
 */
export function readOrbPermission(profileDir: string): OrbPermissionPreset {
  try {
    const value: unknown = JSON.parse(readFileSync(join(profileDir, ORB_PERMISSION_FILE), 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_ORB_PERMISSION
    const preset = (value as { preset?: unknown }).preset
    return isOrbPermissionPreset(preset) ? preset : DEFAULT_ORB_PERMISSION
  } catch {
    // Missing or invalid profile JSON uses the shipped Full access default.
    return DEFAULT_ORB_PERMISSION
  }
}

/**
 * Persist the overlay Access preset.
 * @param profileDir - Desktop profile directory.
 * @param preset - value to write.
 */
export function writeOrbPermission(profileDir: string, preset: OrbPermissionPreset): void {
  writeFileSync(
    join(profileDir, ORB_PERMISSION_FILE),
    `${JSON.stringify({ preset }, undefined, 2)}\n`,
  )
}
