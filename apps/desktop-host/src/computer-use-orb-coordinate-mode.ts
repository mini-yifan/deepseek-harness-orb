/**
 * Desktop Host plugin that holds the floating-ball Computer Use click encoding.
 * @module @deepseek-ai/dsh-desktop-host/computer-use-orb-coordinate-mode
 */

import type { Context } from '@deepseek-ai/cordis'

/** Click encoding Electron may push for new overlay Computer Use sessions. */
export const ORB_COORDINATE_MODES = ['millifraction', 'pixel'] as const

/** One overlay Computer Use click encoding. */
export type OrbCoordinateMode = (typeof ORB_COORDINATE_MODES)[number]

/** Shipped encoding until Electron pushes a stored preference. New overlay chats start in millifraction. */
export const DEFAULT_ORB_COORDINATE_MODE: OrbCoordinateMode = 'millifraction'

/** Live overlay click encoding for Computer Use blank creates. */
export interface OrbCoordinateModeService {
  /** @returns the latest Electron-pushed encoding, or millifraction before the first push. */
  currentMode(): OrbCoordinateMode
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional Desktop overlay Computer Use click encoding for blank creates. */
    orbCoordinateMode: OrbCoordinateModeService
  }
}

/** Cordis plugin name matching the Desktop overlay YAML id. */
export const name = 'computer-use-orb-coordinate-mode'

let mode: OrbCoordinateMode = DEFAULT_ORB_COORDINATE_MODE

/**
 * True when `value` is one of {@link ORB_COORDINATE_MODES}.
 * @param value - Host IPC payload.
 * @returns whether `value` may replace the live overlay encoding.
 */
export function isOrbCoordinateMode(value: unknown): value is OrbCoordinateMode {
  return typeof value === 'string'
    && (ORB_COORDINATE_MODES as readonly string[]).includes(value)
}

/**
 * Replace the stored overlay Computer Use click encoding.
 * @param next - Electron-pushed encoding.
 */
export function setOrbCoordinateMode(next: OrbCoordinateMode): void {
  mode = next
}

/**
 * Restore the shipped millifraction default. Tests reset module state between cases.
 * @returns nothing; module state is {@link DEFAULT_ORB_COORDINATE_MODE} afterwards.
 */
export function clearOrbCoordinateMode(): void {
  mode = DEFAULT_ORB_COORDINATE_MODE
}

/**
 * Publish the overlay Computer Use click encoding for blank session creates.
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  ctx.provide('orbCoordinateMode', {
    currentMode: () => mode,
  })
}
