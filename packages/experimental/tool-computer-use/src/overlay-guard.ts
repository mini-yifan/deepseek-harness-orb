/**
 * Optional overlay cloak around Computer Use capture and HID.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/overlay-guard
 */

import type { DesktopBackend } from './backend.ts'
import { runWithCaptureExcludeWindowIds } from './capture-exclude.ts'

/**
 * Overlay CGWindowIDs to omit from one ScreenCaptureKit display capture.
 * Desktop Host fills this from Electron's overlay-guard ack; CLI leaves it empty.
 */
export interface OverlayCaptureSession {
  readonly excludeWindowIds: readonly number[]
}

/**
 * Cloak host chrome for the duration of one capture or HID call.
 * Desktop Host provides this; Web and CLI compositions omit it.
 */
export interface ComputerUseOverlayGuard {
  /**
   * Exclude host overlay chrome from screen capture while `run` executes, then restore it.
   * @param run - capture implementation; receives overlay window ids from the begin ack.
   * @param signal - cooperative cancellation for the cloak handshake.
   * @returns the value `run` resolves to.
   */
  withCapture<T>(
    run: (session: OverlayCaptureSession) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>
  /**
   * Make host overlay chrome click-through while `run` executes, wait for posted HID events to be hit-tested, then restore hit testing.
   * @param run - HID implementation.
   * @param signal - cooperative cancellation for the cloak handshake.
   * @returns the value `run` resolves to.
   */
  withInput<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Overlay cloak; Desktop Host provides it, other compositions leave it undefined. */
    computerUseOverlayGuard?: ComputerUseOverlayGuard
  }
}

/**
 * Overlay window ids from one `withCapture` session.
 * When the host omits the session, capture runs with an empty id list.
 * @param session - begin-ack payload, or `undefined` when the host omitted it.
 * @returns ids to omit, or `[]`.
 */
function captureExcludeIds(session: OverlayCaptureSession | undefined): readonly number[] {
  return session?.excludeWindowIds ?? []
}

/**
 * Wrap a desktop backend so capture and HID run inside overlay-guard intervals.
 * `listScreens` is unwrapped because it does not capture pixels or post input.
 * @param inner - platform or fake backend.
 * @param guard - host overlay cloak.
 * @returns a backend that cloaks around capture and HID.
 */
export function wrapDesktopBackend(
  inner: DesktopBackend,
  guard: ComputerUseOverlayGuard,
): DesktopBackend {
  return {
    listScreens: signal => inner.listScreens(signal),
    capture: (screen, signal) => guard.withCapture(
      session => runWithCaptureExcludeWindowIds(
        captureExcludeIds(session),
        () => inner.capture(screen, signal),
      ),
      signal,
    ),
    click: (input, signal) => guard.withInput(() => inner.click(input, signal), signal),
    typeText: (input, signal) => guard.withInput(() => inner.typeText(input, signal), signal),
    scroll: (input, signal) => guard.withInput(() => inner.scroll(input, signal), signal),
    hotkey: (input, signal) => guard.withInput(() => inner.hotkey(input, signal), signal),
  }
}
