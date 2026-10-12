/** Persist floating-ball enablement in the Desktop profile. */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Profile-relative JSON file holding floating-ball enablement. */
export const BALL_ENABLED_FILE = 'ball-enabled.json'

/**
 * Read whether the floating ball is enabled. Missing or invalid state means enabled:
 * a profile that never disabled the ball keeps its shipped behavior.
 * @param profileDir - Desktop profile directory.
 * @returns true when the ball should exist.
 */
export function readBallEnabled(profileDir: string): boolean {
  try {
    const value: unknown = JSON.parse(readFileSync(join(profileDir, BALL_ENABLED_FILE), 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return true
    const record = value as { enabled?: unknown }
    return typeof record.enabled === 'boolean' ? record.enabled : true
  } catch {
    // Missing or invalid profile JSON keeps the ball enabled.
    return true
  }
}

/**
 * Persist floating-ball enablement.
 * @param profileDir - Desktop profile directory.
 * @param enabled - false disables the ball and keeps Computer Use in the main window.
 */
export function writeBallEnabled(profileDir: string, enabled: boolean): void {
  writeFileSync(
    join(profileDir, BALL_ENABLED_FILE),
    `${JSON.stringify({ enabled }, undefined, 2)}\n`,
  )
}
