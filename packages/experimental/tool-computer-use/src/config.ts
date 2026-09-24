/**
 * Validated Computer Use tunables from cordis.yml.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/config
 */

import z from '@deepseek-ai/schemastery'

/** Loader-accepted Computer Use configuration. */
export interface Config {
  /**
   * Milliseconds to wait after a GUI action before inspect and pixel capture, so open menus are listed.
   * Default: 600.
   */
  readonly postActionWaitMs?: number
}

/** Config after defaults and load-time validation. */
export interface ResolvedComputerUseConfig {
  readonly postActionWaitMs: number
}

/** Loader schema for the Computer Use plugin. */
export const Config: z<Config> = z.object({
  postActionWaitMs: z.number().default(600),
})

function requireFiniteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite number ≥ 0`)
  }
  return value
}

/**
 * Apply defaults and reject invalid tunables at load.
 * @param config - plugin config, possibly partial.
 * @returns resolved tunables.
 */
export function resolveComputerUseConfig(config: Config = {}): ResolvedComputerUseConfig {
  return {
    postActionWaitMs: requireFiniteNonNegative(config.postActionWaitMs ?? 600, 'postActionWaitMs'),
  }
}
