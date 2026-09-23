/**
 * Capture-interval overlay window ids.
 * {@link wrapDesktopBackend} stores the ids. macOS overlay-exclude ScreenCaptureKit and the Windows foreground walk both read them.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/capture-exclude
 */

import { AsyncLocalStorage } from 'node:async_hooks'

const captureExclude = new AsyncLocalStorage<readonly number[]>()

/**
 * Overlay window ids to exclude from the current capture, or `[]` outside a cloak.
 * macOS values are CGWindowIDs. Windows values are HWNDs.
 * @returns window ids from the active `withCapture` session.
 */
export function activeCaptureExcludeWindowIds(): readonly number[] {
  return captureExclude.getStore() ?? []
}

/**
 * Run `fn` with overlay window ids visible to {@link activeCaptureExcludeWindowIds}.
 * @param excludeWindowIds - overlay window ids the active capture must omit.
 * @param fn - capture implementation.
 * @returns the value `fn` returns.
 */
export function runWithCaptureExcludeWindowIds<T>(
  excludeWindowIds: readonly number[],
  fn: () => T,
): T {
  return captureExclude.run(excludeWindowIds, fn)
}
