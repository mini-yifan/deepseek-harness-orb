/**
 * Desktop backend used when Computer Use is loaded off macOS.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/unsupported
 */

import type { DesktopBackend } from './backend.ts'

/** Fixed execute-time error for non-macOS hosts. */
export const UNSUPPORTED_DESKTOP_MESSAGE = 'computer-use: desktop control is implemented only on macOS'

/**
 * Construct a backend whose methods fail at execute time so Linux CI can still load the plugin.
 * @returns a backend that throws {@link UNSUPPORTED_DESKTOP_MESSAGE} from every method.
 */
export function createUnsupportedDesktopBackend(): DesktopBackend {
  const fail = (): Promise<never> => Promise.reject(new Error(UNSUPPORTED_DESKTOP_MESSAGE))
  return {
    listScreens: fail,
    capture: fail,
    inspectForeground: fail,
    listApps: fail,
    openApp: fail,
    click: fail,
    typeText: fail,
    scroll: fail,
    hotkey: fail,
    longPress: fail,
    drag: fail,
    openInBrowser: fail,
    openInFinder: fail,
    copyImageToClipboard: fail,
    withGuiTurn: run => run(),
  }
}
