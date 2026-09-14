/**
 * Desktop overlay locator: publishes the Computer Use extra agent-presets root
 * from the runtime extra package without declaring that experimental package
 * as a Desktop Host npm dependency.
 * @module @deepseek-ai/dsh-desktop-host/computer-use-preset-root
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Absolute directory of the Computer Use extra agent-presets root. */
    computerUsePresetRoot: string
  }
}

/** npm name of the experimental Computer Use package copied as a runtime extra. */
export const COMPUTER_USE_PACKAGE = '@deepseek-ai/dsh-experimental-tool-computer-use'

/** Cordis plugin name matching the Web overlay locator. */
export const name = 'computer-use-preset-root'

/**
 * Resolve the extra presets directory from a Desktop runtime tree.
 * @param runtimeDir - immutable packages carried by the Electron application.
 * @returns the absolute presets directory, or undefined when the extra is absent.
 */
export function computerUsePresetRoot(runtimeDir: string): string | undefined {
  const path = join(runtimeDir, 'node_modules', ...COMPUTER_USE_PACKAGE.split('/'), 'presets')
  return existsSync(path) ? path : undefined
}

/**
 * Publish the extra Computer Use presets root for Desktop `agent-presets` inject.
 * @param ctx - Host context. The overlay injects this service on `agent-presets`.
 * @throws when the experimental package is missing from the Desktop runtime.
 */
export function apply(ctx: Context): void {
  const require = createRequire(import.meta.url)
  let fromPackage: string | undefined
  try {
    fromPackage = join(dirname(require.resolve(`${COMPUTER_USE_PACKAGE}/package.json`)), 'presets')
  } catch {
    // MODULE_NOT_FOUND: this Host module is not adjacent to the runtime extra.
    fromPackage = undefined
  }
  const presetRoot = [computerUsePresetRoot(process.cwd()), fromPackage]
    .find((path): path is string => path !== undefined && existsSync(path))
  if (presetRoot === undefined) {
    throw new Error('dsh desktop: Computer Use experimental package is missing from the Desktop runtime')
  }
  ctx.provide('computerUsePresetRoot', presetRoot)
}
