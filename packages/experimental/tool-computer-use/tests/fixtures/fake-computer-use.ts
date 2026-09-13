/** Test-only Computer Use over a fixture PNG desktop. Never posts HID. */

import type { Context } from '@deepseek-ai/cordis'
import {
  applyComputerUse,
  createFakeDesktopBackend,
  resolveComputerUseConfig,
  type Config,
} from '../../src/index.ts'

/** Cordis plugin name. */
export const name = 'fixture-computer-use'

/** Services required at apply time. */
export const inject = ['tools', 'systemPrompt', 'attachments']

/** Loader schema re-export so the fixture accepts the same tunables. */
export { Config } from '../../src/index.ts'

/**
 * Register Computer Use over a fake desktop.
 * @param ctx - registration scope; `inject` must already be satisfied.
 * @param config - optional tunables; the Loader fixture pins `postActionWaitMs: 0`.
 */
export function apply(ctx: Context, config: Config = {}): void {
  applyComputerUse(ctx, createFakeDesktopBackend(), resolveComputerUseConfig({
    postActionWaitMs: config.postActionWaitMs ?? 0,
  }))
}
