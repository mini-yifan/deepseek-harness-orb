/**
 * Validated Computer Use tunables from cordis.yml.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/config
 */

import z from '@deepseek-ai/schemastery'

/** Loader-accepted Computer Use configuration. */
export interface Config {
  /**
   * Milliseconds to wait after a GUI action before recapturing.
   * Default: 500.
   */
  readonly postActionWaitMs?: number
  /**
   * Maximum seconds the `wait` tool may pause. Default: 5.
   */
  readonly maxWaitSeconds?: number
  /**
   * Maximum number of displays captured per observation. Default: 4.
   */
  readonly maxScreens?: number
}

/** Config after defaults and load-time validation. */
export interface ResolvedComputerUseConfig {
  readonly postActionWaitMs: number
  readonly maxWaitSeconds: number
  readonly maxScreens: number
}

/** Loader schema for the Computer Use plugin. */
export const Config: z<Config> = z.object({
  postActionWaitMs: z.number().default(500),
  maxWaitSeconds: z.number().default(5),
  maxScreens: z.number().default(4),
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
  const postActionWaitMs = requireFiniteNonNegative(config.postActionWaitMs ?? 500, 'postActionWaitMs')
  const maxWaitSeconds = requireFiniteNonNegative(config.maxWaitSeconds ?? 5, 'maxWaitSeconds')
  const maxScreens = requireFiniteNonNegative(config.maxScreens ?? 4, 'maxScreens')
  if (!Number.isInteger(maxScreens) || maxScreens < 1) {
    throw new Error('maxScreens must be an integer ≥ 1')
  }
  return { postActionWaitMs, maxWaitSeconds, maxScreens }
}
