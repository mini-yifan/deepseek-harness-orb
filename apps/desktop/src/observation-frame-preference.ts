/** Persist the Computer Use observation-ribbon preference in the Desktop profile. */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Profile-relative JSON file holding the observation-ribbon preference. */
export const OBSERVATION_FRAME_FILE = 'observation-frame.json'

/**
 * Read whether Computer Use draws the observation ribbon. Missing or invalid state
 * means enabled: the ribbon is on by default.
 * @param profileDir - Desktop profile directory.
 * @returns true when the ribbon may be shown.
 */
export function readObservationFrameEnabled(profileDir: string): boolean {
  try {
    const value: unknown = JSON.parse(readFileSync(join(profileDir, OBSERVATION_FRAME_FILE), 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return true
    const record = value as { enabled?: unknown }
    return typeof record.enabled === 'boolean' ? record.enabled : true
  } catch {
    // Missing or invalid profile JSON keeps the ribbon enabled.
    return true
  }
}

/**
 * Persist the observation-ribbon preference.
 * @param profileDir - Desktop profile directory.
 * @param enabled - false hides the ribbon for every later Computer Use capture.
 */
export function writeObservationFrameEnabled(profileDir: string, enabled: boolean): void {
  writeFileSync(
    join(profileDir, OBSERVATION_FRAME_FILE),
    `${JSON.stringify({ enabled }, undefined, 2)}\n`,
  )
}
