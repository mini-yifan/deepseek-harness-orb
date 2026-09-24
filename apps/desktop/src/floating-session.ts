/** Persist the macOS floating-ball Computer Use Session id in the Desktop profile. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Profile-relative JSON file holding the floating-ball Session id. */
export const FLOATING_SESSION_FILE = 'floating-session.json'

/**
 * Read the persisted floating-ball Session id.
 * @param profileDir - Desktop profile directory.
 * @returns the stored id, or undefined when absent or invalid.
 */
export function readFloatingSessionId(profileDir: string): string | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(join(profileDir, FLOATING_SESSION_FILE), 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const sessionId = (value as { sessionId?: unknown }).sessionId
    return typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
  } catch {
    // Missing or invalid profile JSON means the overlay has no Session yet.
    return undefined
  }
}

/**
 * Persist the floating-ball Session id.
 * @param profileDir - Desktop profile directory.
 * @param sessionId - Computer Use Session identity created for the ball.
 */
export function writeFloatingSessionId(profileDir: string, sessionId: string): void {
  writeFileSync(
    join(profileDir, FLOATING_SESSION_FILE),
    `${JSON.stringify({ sessionId }, undefined, 2)}\n`,
  )
}

/**
 * Create the `dsh_orb` workspace directory when missing.
 * @param path - absolute directory used as both cwd and sidebar folder.
 * @returns the same path after `mkdir`.
 */
export function ensureOrbWorkspaceDir(path: string): string {
  mkdirSync(path, { recursive: true })
  return path
}
