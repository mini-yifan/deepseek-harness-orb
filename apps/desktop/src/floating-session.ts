/** Persist the macOS floating-ball Computer Use Session id in the Desktop profile. */

import { readFileSync, writeFileSync } from 'node:fs'
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
 * Script that hides the orb Session from the main-window sidebar and notifies
 * an already-booted client to re-derive the tree.
 * @param sessionId - Computer Use Session identity created for the ball.
 * @returns JavaScript assigned into an `app` renderer.
 */
export function hiddenSessionBroadcast(sessionId: string): string {
  return `globalThis.__DSH_HIDDEN_SESSION_IDS__=${JSON.stringify([sessionId])};globalThis.dispatchEvent(new Event('dsh-hidden-sessions-changed'))`
}
