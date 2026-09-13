/**
 * Snapshot-only Computer Use: a fixture PNG desktop that records no HID.
 * The relative source import keeps the CLI free of this experimental package;
 * production `apply` is not mounted here.
 */
import {
  applyComputerUse,
  createFakeDesktopBackend,
  resolveComputerUseConfig,
} from '../../../packages/experimental/tool-computer-use/src/index.ts'

/** Cordis plugin name. */
export const name = 'computer-use-fake-desktop'

/** Services required at apply time. */
export const inject = ['tools', 'systemPrompt', 'attachments']

/**
 * Register Computer Use over a fixture desktop.
 * @param ctx - registration scope; `inject` must already be satisfied.
 * @param config - optional tunables; snapshot overlays pin `postActionWaitMs: 0`.
 */
export function apply(ctx, config = {}) {
  applyComputerUse(ctx, createFakeDesktopBackend(), resolveComputerUseConfig({
    postActionWaitMs: config.postActionWaitMs ?? 0,
  }))
}
