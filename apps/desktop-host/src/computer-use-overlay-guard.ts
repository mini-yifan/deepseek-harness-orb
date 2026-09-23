/**
 * Desktop Host Cordis service that cloaks the Electron overlay around Computer Use capture and HID.
 * @module @deepseek-ai/dsh-desktop-host/computer-use-overlay-guard
 */

import { setTimeout as sleep } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'

/** Overlay chrome mode for one Computer Use capture or HID burst. */
export type OverlayGuardMode = 'capture' | 'input'

/** Begin or end one overlay-guard interval. */
export type OverlayGuardAction = 'begin' | 'end'

/** Host → Electron overlay-guard IPC event. */
export interface OverlayGuardIpcEvent {
  readonly type: 'overlay-guard'
  readonly requestId: number
  readonly action: OverlayGuardAction
  readonly mode: OverlayGuardMode
}

/** Logical global rectangle for the Computer Use observation-frame overlay. */
export interface ObservationFrameBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Host → Electron observation-frame IPC event. */
export interface ObservationFrameIpcEvent {
  readonly type: 'observation-frame'
  readonly requestId: number
  readonly bounds: ObservationFrameBounds | null
}

/** Overlay-exclude ScreenCaptureKit JPEG request. */
export interface OverlayExcludedRegionCaptureInput {
  readonly region: string
  readonly excludeWindowIds: readonly number[]
  readonly output: string
}

/** Host → Electron overlay-exclude capture IPC event. */
export interface SckCaptureIpcEvent extends OverlayExcludedRegionCaptureInput {
  readonly type: 'sck-capture'
  readonly requestId: number
}

/** Overlay-guard, observation-frame, and overlay-exclude capture events on the same Host → Electron transport. */
export type OverlayGuardTransportEvent = OverlayGuardIpcEvent | ObservationFrameIpcEvent | SckCaptureIpcEvent

/**
 * Overlay window ids to omit from one capture.
 * macOS values are CGWindowIDs for ScreenCaptureKit. Windows values are HWNDs.
 * Electron fills this on overlay-guard ack; an empty list means no overlay window.
 */
export interface OverlayCaptureSession {
  readonly excludeWindowIds: readonly number[]
}

/**
 * Cloak the Desktop overlay for the duration of one capture or HID call.
 * Desktop Host provides this; Computer Use looks it up optionally and no-ops when it is absent.
 * Computer Use owns the optional Context merge so the Host aggregate does not collide two types.
 */
export interface ComputerUseOverlayGuard {
  /**
   * Exclude the overlay from screen capture while `run` executes, then restore it.
   * Nested `withCapture` inside `withCapture` reuses the outer exclude ids.
   * Nested `withCapture` inside `withInput` still sends capture begin/end so exclude ids refresh
   * after the observation frame appears, without toggling HID click-through.
   * @param run - capture implementation; receives overlay window ids from the begin ack.
   * @param signal - cooperative cancellation for the begin ack wait.
   * @returns the value `run` resolves to.
   */
  withCapture<T>(
    run: (session: OverlayCaptureSession) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>
  /**
   * Make the overlay click-through while `run` executes, wait for posted HID events to be hit-tested, then restore hit testing.
   * Nested calls share the outermost input interval.
   * @param run - HID implementation.
   * @param signal - cooperative cancellation for the begin ack wait.
   * @returns the value `run` resolves to.
   */
  withInput<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T>
  /**
   * Show or hide the observation-frame ribbon around the current Computer Use capture rectangle.
   * Pass-through when Electron is not attached. Acks before returning so the next capture exclude list includes the frame.
   * Abort of a SHOW hides the ribbon and waits for that hide ack without the aborted signal; abort of a hide rejects the wait.
   * @param bounds - observation union in global logical points, or `null` to hide.
   * @param signal - cooperative cancellation for the SHOW ack wait. Hide acks ignore it.
   */
  setObservationFrame(bounds: ObservationFrameBounds | null, signal?: AbortSignal): Promise<void>
  /**
   * Capture `input.region` as JPEG at `input.output`, omitting overlay CGWindowIDs in the Electron process.
   * Pass-through hosts omit this method; CLI then spawns `macos-sck-capture`.
   * @param input - region `x,y,w,h`, overlay window ids, and JPEG destination path.
   * @param signal - cooperative cancellation for the ack wait.
   */
  captureExcludedRegion?(input: OverlayExcludedRegionCaptureInput, signal?: AbortSignal): Promise<void>
}

/** Milliseconds to wait for Electron's overlay-guard ack before failing the Computer Use call. */
export const OVERLAY_GUARD_ACK_TIMEOUT_MS = 1_000

/** Milliseconds to wait for Electron's overlay-exclude capture ack. Screen Recording prompts can appear. */
export const SCK_CAPTURE_ACK_TIMEOUT_MS = 30_000

/** Milliseconds Host waits after HID returns before sending input end, so WindowServer finishes hit-testing posted CGEvents. */
export const OVERLAY_GUARD_INPUT_DRAIN_MS = 80

/** Cordis plugin name matching the Desktop overlay YAML id. */
export const name = 'computer-use-overlay-guard'

interface PendingExcludeAck {
  readonly resolve: (excludeWindowIds: readonly number[]) => void
  readonly reject: (error: Error) => void
}

interface PendingFrameAck {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

interface PendingSckAck {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

let nextRequestId = 1
let transportSend: ((event: OverlayGuardTransportEvent) => void) | undefined
const pendingExclude = new Map<number, PendingExcludeAck>()
const pendingFrame = new Map<number, PendingFrameAck>()
const pendingSck = new Map<number, PendingSckAck>()
/** Nested withInput / withCapture share one Electron cloak; only depth 0 sends begin/end. */
let inputDepth = 0
let captureDepth = 0
let activeExcludeWindowIds: readonly number[] = []
/** Turn signals that already send observation-frame hide on abort; recapture reuses one controller. */
const armedObservationFrameAbort = new WeakSet<AbortSignal>()

function resetOverlayGuardDepths(): void {
  inputDepth = 0
  captureDepth = 0
  activeExcludeWindowIds = []
}

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

/**
 * Install the Host → Electron sender used by {@link apply}.
 * `main` calls this before Cordis boot so Computer Use can cloak after `ready`.
 * @param send - `process.send` wrapper that already handles a closed IPC channel.
 */
export function setOverlayGuardTransport(send: (event: OverlayGuardTransportEvent) => void): void {
  transportSend = send
}

/**
 * Drop the sender and fail every in-flight ack wait.
 * @param error - rejection for pending Computer Use cloak calls.
 */
export function clearOverlayGuardTransport(error: Error): void {
  transportSend = undefined
  resetOverlayGuardDepths()
  for (const waiter of pendingExclude.values()) waiter.reject(error)
  pendingExclude.clear()
  for (const waiter of pendingFrame.values()) waiter.reject(error)
  pendingFrame.clear()
  for (const waiter of pendingSck.values()) waiter.reject(error)
  pendingSck.clear()
}

/**
 * Complete one Electron overlay-guard acknowledgement.
 * @param requestId - id from the matching Host `overlay-guard` event.
 * @param excludeWindowIds - overlay window ids from the ack; empty when no overlay exists.
 * @returns whether a waiter existed.
 */
export function completeOverlayGuardAck(
  requestId: number,
  excludeWindowIds: readonly number[] = [],
): boolean {
  const waiter = pendingExclude.get(requestId)
  if (waiter === undefined) return false
  pendingExclude.delete(requestId)
  waiter.resolve(excludeWindowIds)
  return true
}

/**
 * Complete one Electron observation-frame acknowledgement.
 * @param requestId - id from the matching Host `observation-frame` event.
 * @returns whether a waiter existed.
 */
export function completeObservationFrameAck(requestId: number): boolean {
  const waiter = pendingFrame.get(requestId)
  if (waiter === undefined) return false
  pendingFrame.delete(requestId)
  waiter.resolve()
  return true
}

/**
 * Complete one Electron overlay-exclude capture acknowledgement.
 * @param requestId - id from the matching Host `sck-capture` event.
 * @param error - failure message; omit or pass empty on success.
 * @returns whether a waiter existed.
 */
export function completeSckCaptureAck(requestId: number, error?: string): boolean {
  const waiter = pendingSck.get(requestId)
  if (waiter === undefined) return false
  pendingSck.delete(requestId)
  if (error !== undefined && error !== '') waiter.reject(new Error(error))
  else waiter.resolve()
  return true
}

function waitExcludeAck(requestId: number, signal?: AbortSignal): Promise<readonly number[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(errorOf(signal.reason, 'dsh desktop: overlay-guard aborted'))
      return
    }
    const timer = setTimeout(() => {
      settle(() => { reject(new Error('dsh desktop: overlay-guard ack timed out')) })
    }, OVERLAY_GUARD_ACK_TIMEOUT_MS)
    timer.unref()
    const settle = (next: () => void): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      pendingExclude.delete(requestId)
      next()
    }
    const onAbort = (): void => {
      settle(() => { reject(errorOf(signal?.reason, 'dsh desktop: overlay-guard aborted')) })
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pendingExclude.set(requestId, {
      resolve: (excludeWindowIds) => { settle(() => { resolve(excludeWindowIds) }) },
      reject: (error) => { settle(() => { reject(error) }) },
    })
  })
}

function waitFrameAck(requestId: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(errorOf(signal.reason, 'dsh desktop: observation-frame aborted'))
      return
    }
    const timer = setTimeout(() => {
      settle(() => { reject(new Error('dsh desktop: observation-frame ack timed out')) })
    }, OVERLAY_GUARD_ACK_TIMEOUT_MS)
    timer.unref()
    const settle = (next: () => void): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      pendingFrame.delete(requestId)
      next()
    }
    const onAbort = (): void => {
      settle(() => { reject(errorOf(signal?.reason, 'dsh desktop: observation-frame aborted')) })
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pendingFrame.set(requestId, {
      resolve: () => { settle(() => { resolve() }) },
      reject: (error) => { settle(() => { reject(error) }) },
    })
  })
}

function waitSckAck(requestId: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(errorOf(signal.reason, 'dsh desktop: overlay-exclude capture aborted'))
      return
    }
    const timer = setTimeout(() => {
      settle(() => { reject(new Error('dsh desktop: sck-capture ack timed out')) })
    }, SCK_CAPTURE_ACK_TIMEOUT_MS)
    timer.unref()
    const settle = (next: () => void): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      pendingSck.delete(requestId)
      next()
    }
    const onAbort = (): void => {
      settle(() => { reject(errorOf(signal?.reason, 'dsh desktop: overlay-exclude capture aborted')) })
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pendingSck.set(requestId, {
      resolve: () => { settle(() => { resolve() }) },
      reject: (error) => { settle(() => { reject(error) }) },
    })
  })
}

async function withCaptureMode<T>(
  send: (event: OverlayGuardTransportEvent) => void,
  run: (session: OverlayCaptureSession) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const sendCaptureIpc = captureDepth === 0
  captureDepth += 1
  let sentBegin = false
  try {
    if (sendCaptureIpc) {
      const beginId = nextRequestId++
      send({ type: 'overlay-guard', requestId: beginId, action: 'begin', mode: 'capture' })
      sentBegin = true
      activeExcludeWindowIds = await waitExcludeAck(beginId, signal)
    }
    return await run({ excludeWindowIds: activeExcludeWindowIds })
  } finally {
    captureDepth -= 1
    if (sentBegin) {
      const endId = nextRequestId++
      send({ type: 'overlay-guard', requestId: endId, action: 'end', mode: 'capture' })
      try {
        await waitExcludeAck(endId)
      } catch {
        // Electron already gone, ack lost, or Host stopping; Host-exit restore covers the overlay.
      }
      if (inputDepth === 0 && captureDepth === 0) activeExcludeWindowIds = []
    }
  }
}

async function withInputMode<T>(
  send: (event: OverlayGuardTransportEvent) => void,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const outermost = inputDepth === 0
  inputDepth += 1
  let sentBegin = false
  let hidBegan = false
  try {
    if (outermost) {
      const beginId = nextRequestId++
      send({ type: 'overlay-guard', requestId: beginId, action: 'begin', mode: 'input' })
      sentBegin = true
      activeExcludeWindowIds = await waitExcludeAck(beginId, signal)
      hidBegan = true
    }
    return await run()
  } finally {
    inputDepth -= 1
    if (sentBegin) {
      if (hidBegan) await sleep(OVERLAY_GUARD_INPUT_DRAIN_MS)
      const endId = nextRequestId++
      send({ type: 'overlay-guard', requestId: endId, action: 'end', mode: 'input' })
      try {
        await waitExcludeAck(endId)
      } catch {
        // Electron already gone, ack lost, or Host stopping; Host-exit restore covers the overlay.
      }
      if (captureDepth === 0) activeExcludeWindowIds = []
    }
  }
}

async function sendObservationFrameHide(
  send: (event: OverlayGuardTransportEvent) => void,
): Promise<void> {
  const requestId = nextRequestId++
  send({ type: 'observation-frame', requestId, bounds: null })
  await waitFrameAck(requestId)
}

function armObservationFrameAbortHide(
  send: (event: OverlayGuardTransportEvent) => void,
  signal: AbortSignal,
): void {
  if (armedObservationFrameAbort.has(signal)) return
  armedObservationFrameAbort.add(signal)
  signal.addEventListener('abort', () => {
    void sendObservationFrameHide(send).catch(() => {
      // Electron already gone, ack lost, or Host stopping; Host-exit restore covers the overlay.
    })
  }, { once: true })
}

async function setObservationFrameMode(
  send: (event: OverlayGuardTransportEvent) => void,
  bounds: ObservationFrameBounds | null,
  signal?: AbortSignal,
): Promise<void> {
  if (bounds !== null && signal !== undefined) {
    armObservationFrameAbortHide(send, signal)
  }
  if (bounds !== null && signal?.aborted) {
    try {
      await sendObservationFrameHide(send)
    } catch {
      // Electron already gone, ack lost, or Host stopping; Host-exit restore covers the overlay.
    }
    throw errorOf(signal.reason, 'dsh desktop: observation-frame aborted')
  }
  const requestId = nextRequestId++
  send({ type: 'observation-frame', requestId, bounds })
  await waitFrameAck(requestId, signal)
}

async function captureExcludedRegionMode(
  send: (event: OverlayGuardTransportEvent) => void,
  input: OverlayExcludedRegionCaptureInput,
  signal?: AbortSignal,
): Promise<void> {
  const requestId = nextRequestId++
  send({
    type: 'sck-capture',
    requestId,
    region: input.region,
    excludeWindowIds: input.excludeWindowIds,
    output: input.output,
  })
  await waitSckAck(requestId, signal)
}

function passThroughGuard(): ComputerUseOverlayGuard {
  return {
    withCapture: run => run({ excludeWindowIds: [] }),
    withInput: run => run(),
    setObservationFrame: () => Promise.resolve(),
  }
}

/**
 * Construct an overlay-guard that uses an explicit sender, or a pass-through when `send` is omitted.
 * @param send - Host → Electron overlay-guard sender.
 * @returns capture and HID cloak helpers.
 */
export function createComputerUseOverlayGuard(
  send?: (event: OverlayGuardTransportEvent) => void,
): ComputerUseOverlayGuard {
  if (send === undefined) return passThroughGuard()
  return {
    withCapture: (run, signal) => withCaptureMode(send, run, signal),
    withInput: (run, signal) => withInputMode(send, run, signal),
    setObservationFrame: (bounds, signal) => setObservationFrameMode(send, bounds, signal),
    captureExcludedRegion: (input, signal) => captureExcludedRegionMode(send, input, signal),
  }
}

/**
 * Publish the overlay-guard service. Cloak IPC runs only after {@link setOverlayGuardTransport}.
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  ctx.provide('computerUseOverlayGuard', {
    withCapture: (run, signal) => {
      const send = transportSend
      return send === undefined ? run({ excludeWindowIds: [] }) : withCaptureMode(send, run, signal)
    },
    withInput: (run, signal) => {
      const send = transportSend
      return send === undefined ? run() : withInputMode(send, run, signal)
    },
    setObservationFrame: (bounds, signal) => {
      const send = transportSend
      return send === undefined ? Promise.resolve() : setObservationFrameMode(send, bounds, signal)
    },
    captureExcludedRegion: (input, signal) => {
      const send = transportSend
      if (send === undefined) {
        return Promise.reject(new Error('dsh desktop: overlay-exclude capture is not attached'))
      }
      return captureExcludedRegionMode(send, input, signal)
    },
  } satisfies ComputerUseOverlayGuard)
}
