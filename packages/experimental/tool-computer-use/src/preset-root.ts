/**
 * Overlay-only plugin: publishes this package's extra agent-presets root.
 *
 * Patch replacement config stays literal, so the overlay cannot name a path
 * relative to the patch file. This plugin resolves `presets/` next to the
 * package (both `src/` under tsx and bundled `lib/`) and provides that
 * absolute directory for the overlay's `!!js ctx.computerUsePresetRoot`.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/preset-root
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Absolute directory of this package's extra agent-presets root. */
    computerUsePresetRoot: string
  }
}

/** Cordis plugin name. */
export const name = 'computer-use-preset-root'

/**
 * Absolute `presets/` directory this package ships.
 *
 * Resolved from this module so the source overlay (`src/`) and the built
 * overlay (`lib/`) both point at the same directory.
 */
export const PRESET_ROOT = fileURLToPath(new URL('../presets', import.meta.url))

/**
 * Publish {@link PRESET_ROOT} for the overlay's `agent-presets` config.
 * @param ctx - Host context. The overlay injects this service on the
 * `agent-presets` row, then interpolates `ctx.computerUsePresetRoot`.
 * @throws when {@link PRESET_ROOT} is missing, so a broken checkout cannot become an empty extra root.
 */
export function apply(ctx: Context): void {
  if (!existsSync(PRESET_ROOT)) {
    throw new Error(`computer-use: preset root is missing: ${PRESET_ROOT}`)
  }
  ctx.provide('computerUsePresetRoot', PRESET_ROOT)
}
