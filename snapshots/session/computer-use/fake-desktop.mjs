/**
 * Snapshot-only Computer Use: a fixture PNG desktop that records no HID.
 * The relative source import keeps the CLI free of this experimental package;
 * production `apply` is not mounted here. Headless has no Session Remote, so
 * this overlay also stubs `sessionController` and registers `code_agent` to pin
 * the schema that the Computer Use preset ships in Desktop and Web.
 */
import {
  applyComputerUse,
  createFakeDesktopBackend,
  resolveComputerUseConfig,
} from '../../../packages/experimental/tool-computer-use/src/index.ts'
import { apply as applyCodeAgent } from '../../../packages/experimental/tool-computer-use/src/code-agent.ts'

/** Cordis plugin name. */
export const name = 'computer-use-fake-desktop'

/** Services required at apply time. */
export const inject = ['tools', 'systemPrompt', 'attachments']

/**
 * Register Computer Use over a fixture desktop and pin `code_agent`.
 * @param ctx - registration scope; `inject` must already be satisfied.
 * @param config - optional tunables; snapshot overlays pin `postActionWaitMs: 0`.
 */
export function apply(ctx, config = {}) {
  applyComputerUse(ctx, createFakeDesktopBackend(), resolveComputerUseConfig({
    postActionWaitMs: config.postActionWaitMs ?? 0,
  }))
  ctx.provide('sessionController', {
    create: () => Promise.reject(new Error('snapshot stub: code_agent execute is unreachable')),
    prompt: () => Promise.reject(new Error('snapshot stub: code_agent execute is unreachable')),
    inspect: () => Promise.reject(new Error('snapshot stub: code_agent execute is unreachable')),
  })
  applyCodeAgent(ctx)
}
