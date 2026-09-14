/**
 * Capture-interval overlay window ids for the macOS ScreenCaptureKit helper.
 * {@link wrapDesktopBackend} stores the ids; {@link createMacosDesktopBackend} reads them.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/capture-exclude
 */

import { AsyncLocalStorage } from 'node:async_hooks'

const captureExclude = new AsyncLocalStorage<readonly number[]>()

/**
 * Overlay CGWindowIDs to exclude from the current capture, or `[]` outside a cloak.
 * @returns window ids from the active `withCapture` session.
 */
export function activeCaptureExcludeWindowIds(): readonly number[] {
  return captureExclude.getStore() ?? []
}

/**
 * Run `fn` with overlay window ids visible to {@link activeCaptureExcludeWindowIds}.
 * @param excludeWindowIds - CGWindowIDs ScreenCaptureKit must omit.
 * @param fn - capture implementation.
 * @returns the value `fn` returns.
 */
export function runWithCaptureExcludeWindowIds<T>(
  excludeWindowIds: readonly number[],
  fn: () => T,
): T {
  return captureExclude.run(excludeWindowIds, fn)
}
