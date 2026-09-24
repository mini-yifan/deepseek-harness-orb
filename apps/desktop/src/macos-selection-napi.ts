/** Load the Darwin in-process selection monitor in the Electron process. */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface MacosSelectionNapiBinding {
  start(onLine: (line: string) => void): void
  stop(): void
  excludePids(pids: string): void
  activatePid(pid: number): void
  /** @returns the last non-Electron frontmost pid, or `0` when none is recorded. */
  lastFrontPid(): number
}

let binding: MacosSelectionNapiBinding | undefined

/**
 * Load `macos-selection-napi.node` beside the bundled main script.
 * @returns the native binding.
 */
export function loadMacosSelectionBinding(): MacosSelectionNapiBinding {
  if (binding !== undefined) return binding
  if (process.platform !== 'darwin') {
    throw new Error('dsh desktop: selection monitor is Darwin-only')
  }
  const require = createRequire(import.meta.url)
  binding = require(join(dirname(fileURLToPath(import.meta.url)), 'macos-selection-napi.node')) as MacosSelectionNapiBinding
  return binding
}
