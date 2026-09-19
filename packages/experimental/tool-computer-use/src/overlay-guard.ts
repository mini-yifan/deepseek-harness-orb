/**
 * Optional overlay cloak around Computer Use capture and HID.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/overlay-guard
 */

import type { DesktopBackend } from './backend.ts'
import { runWithCaptureExcludeWindowIds } from './capture-exclude.ts'

/**
 * Overlay CGWindowIDs to omit from one ScreenCaptureKit window capture.
 * Desktop Host fills this from Electron's overlay-guard ack; CLI leaves it empty.
 */
export interface OverlayCaptureSession {
  readonly excludeWindowIds: readonly number[]
}

/** Logical global rectangle for the Computer Use observation-frame overlay. */
export interface ObservationFrameBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Cloak host chrome for the duration of one capture or HID call.
 * Desktop Host provides this; Web and CLI compositions omit it.
 */
export interface ComputerUseOverlayGuard {
  /**
   * Exclude host overlay chrome from screen capture while `run` executes, then restore it.
   * Nested `withCapture` inside `withInput` still sends capture IPC so exclude ids refresh
   * after the observation frame appears.
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
  /**
   * Show or hide the Desktop observation-frame ribbon around the current capture rectangle.
   * Pass-through hosts resolve immediately. Acks before returning so the next capture omits the frame.
   * @param bounds - observation union in global logical points, or `null` to hide.
   * @param signal - cooperative cancellation for the ack wait.
   */
  setObservationFrame(bounds: ObservationFrameBounds | null, signal?: AbortSignal): Promise<void>
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
 * Wrap a desktop backend so capture, foreground inspect, listScreens, HID, openApp, and withGuiTurn run inside overlay-guard intervals.
 * After `listScreens`, the wrapper waits for `setObservationFrame` so the next capture exclude list includes the ribbon.
 * `openApp` and `withGuiTurn` use `withInput` so the overlay yields key status before activate and stays click-through through recapture.
 * Desktop Host refcounts nested cloak calls so one turn sends one input begin/end.
 * `listApps`, `openInBrowser`, `openInFinder`, and `copyImageToClipboard` are unwrapped because
 * they do not capture pixels, inspect windows, post HID, or steal key status.
 * @param inner - platform or fake backend.
 * @param guard - host overlay cloak.
 * @returns a backend that cloaks around capture, inspect, listScreens, HID, openApp, and withGuiTurn.
 */
export function wrapDesktopBackend(
  inner: DesktopBackend,
  guard: ComputerUseOverlayGuard,
): DesktopBackend {
  return {
    withGuiTurn: (run, signal) => guard.withInput(() => inner.withGuiTurn(run, signal), signal),
    listScreens: signal => guard.withCapture(
      session => runWithCaptureExcludeWindowIds(
        captureExcludeIds(session),
        async () => {
          const screens = await inner.listScreens(signal)
          await guard.setObservationFrame(screens[0]?.bounds ?? null, signal)
          return screens
        },
      ),
      signal,
    ),
    capture: (screen, signal) => guard.withCapture(
      session => runWithCaptureExcludeWindowIds(
        captureExcludeIds(session),
        () => inner.capture(screen, signal),
      ),
      signal,
    ),
    inspectForeground: signal => guard.withCapture(
      session => runWithCaptureExcludeWindowIds(
        captureExcludeIds(session),
        () => inner.inspectForeground(signal),
      ),
      signal,
    ),
    listApps: signal => inner.listApps(signal),
    openApp: (input, signal) => guard.withInput(() => inner.openApp(input, signal), signal),
    click: (input, signal) => guard.withInput(() => inner.click(input, signal), signal),
    typeText: (input, signal) => guard.withInput(() => inner.typeText(input, signal), signal),
    scroll: (input, signal) => guard.withInput(() => inner.scroll(input, signal), signal),
    hotkey: (input, signal) => guard.withInput(() => inner.hotkey(input, signal), signal),
    longPress: (input, signal) => guard.withInput(() => inner.longPress(input, signal), signal),
    drag: (input, signal) => guard.withInput(() => inner.drag(input, signal), signal),
    openInBrowser: (input, signal) => inner.openInBrowser(input, signal),
    openInFinder: (input, signal) => inner.openInFinder(input, signal),
    copyImageToClipboard: (input, signal) => inner.copyImageToClipboard(input, signal),
  }
}
