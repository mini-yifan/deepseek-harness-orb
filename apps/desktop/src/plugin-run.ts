/**
 * Host-alive Plugin Market package operations executed in the Electron process.
 * @module @deepseek-ai/dsh-desktop/plugin-run
 */

import {
  parseDesktopPluginArgs,
  type DesktopProjectManager,
  type DesktopPluginRunOutput,
} from './project-manager.ts'

/** Result forwarded to the Desktop Host after one plugin-run IPC exchange. */
export interface DesktopPluginRunResult {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

/**
 * Run one Plugin Market argv against the Desktop profile without stopping the Host.
 * Parse failures and pnpm failures become exit code 1 with stderr text.
 * @param manager - Electron-owned profile manager.
 * @param args - `dsh plugin` arguments after `--profile`.
 * @param output - streamed pnpm output.
 * @param signal - cancellation from the Host.
 */
export async function runDesktopPluginArgs(
  manager: DesktopProjectManager,
  args: readonly string[],
  output: DesktopPluginRunOutput,
  signal?: AbortSignal,
): Promise<DesktopPluginRunResult> {
  let mutation
  try {
    mutation = parseDesktopPluginArgs(args)
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error))
    return { exitCode: 1, signal: null }
  }
  try {
    await manager.mutateWhileRunning(mutation, output, signal)
    return { exitCode: 0, signal: null }
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error))
    return { exitCode: 1, signal: null }
  }
}
