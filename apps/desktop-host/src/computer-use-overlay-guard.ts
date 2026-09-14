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

/**
 * Overlay CGWindowIDs to omit from one ScreenCaptureKit display capture.
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
   * @param run - HID implementation.
   * @param signal - cooperative cancellation for the begin ack wait.
   * @returns the value `run` resolves to.
   */
  withInput<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T>
}

/** Milliseconds to wait for Electron's overlay-guard ack before failing the Computer Use call. */
export const OVERLAY_GUARD_ACK_TIMEOUT_MS = 1_000

/** Milliseconds Host waits after HID returns before sending input end, so WindowServer finishes hit-testing posted CGEvents. */
export const OVERLAY_GUARD_INPUT_DRAIN_MS = 80

/** Cordis plugin name matching the Desktop overlay YAML id. */
export const name = 'computer-use-overlay-guard'

interface PendingAck {
  readonly resolve: (excludeWindowIds: readonly number[]) => void
  readonly reject: (error: Error) => void
}

let nextRequestId = 1
let transportSend: ((event: OverlayGuardIpcEvent) => void) | undefined
const pending = new Map<number, PendingAck>()

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

/**
 * Install the Host → Electron sender used by {@link apply}.
 * `main` calls this before Cordis boot so Computer Use can cloak after `ready`.
 * @param send - `process.send` wrapper that already handles a closed IPC channel.
 */
export function setOverlayGuardTransport(send: (event: OverlayGuardIpcEvent) => void): void {
  transportSend = send
}

/**
 * Drop the sender and fail every in-flight ack wait.
 * @param error - rejection for pending Computer Use cloak calls.
 */
export function clearOverlayGuardTransport(error: Error): void {
  transportSend = undefined
  for (const waiter of pending.values()) waiter.reject(error)
  pending.clear()
}

/**
 * Complete one Electron overlay-guard acknowledgement.
 * @param requestId - id from the matching Host `overlay-guard` event.
 * @param excludeWindowIds - overlay CGWindowIDs from the ack; empty when no overlay exists.
 * @returns whether a waiter existed.
 */
export function completeOverlayGuardAck(
  requestId: number,
  excludeWindowIds: readonly number[] = [],
): boolean {
  const waiter = pending.get(requestId)
  if (waiter === undefined) return false
  pending.delete(requestId)
  waiter.resolve(excludeWindowIds)
  return true
}

function waitAck(requestId: number, signal?: AbortSignal): Promise<readonly number[]> {
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
      pending.delete(requestId)
      next()
    }
    const onAbort = (): void => {
      settle(() => { reject(errorOf(signal?.reason, 'dsh desktop: overlay-guard aborted')) })
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pending.set(requestId, {
      resolve: (excludeWindowIds) => { settle(() => { resolve(excludeWindowIds) }) },
      reject: (error) => { settle(() => { reject(error) }) },
    })
  })
}

async function withCaptureMode<T>(
  send: (event: OverlayGuardIpcEvent) => void,
  run: (session: OverlayCaptureSession) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const beginId = nextRequestId++
  send({ type: 'overlay-guard', requestId: beginId, action: 'begin', mode: 'capture' })
  try {
    const excludeWindowIds = await waitAck(beginId, signal)
    return await run({ excludeWindowIds })
  } finally {
    const endId = nextRequestId++
    send({ type: 'overlay-guard', requestId: endId, action: 'end', mode: 'capture' })
    try {
      await waitAck(endId)
    } catch {
      // Electron already gone, ack lost, or Host stopping; Host-exit restore covers the overlay.
    }
  }
}

async function withInputMode<T>(
  send: (event: OverlayGuardIpcEvent) => void,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const beginId = nextRequestId++
  send({ type: 'overlay-guard', requestId: beginId, action: 'begin', mode: 'input' })
  let hidBegan = false
  try {
    await waitAck(beginId, signal)
    hidBegan = true
    return await run()
  } finally {
    if (hidBegan) await sleep(OVERLAY_GUARD_INPUT_DRAIN_MS)
    const endId = nextRequestId++
    send({ type: 'overlay-guard', requestId: endId, action: 'end', mode: 'input' })
    try {
      await waitAck(endId)
    } catch {
      // Electron already gone, ack lost, or Host stopping; Host-exit restore covers the overlay.
    }
  }
}

/**
 * Construct an overlay-guard that uses an explicit sender, or a pass-through when `send` is omitted.
 * @param send - Host → Electron overlay-guard sender.
 * @returns capture and HID cloak helpers.
 */
export function createComputerUseOverlayGuard(
  send?: (event: OverlayGuardIpcEvent) => void,
): ComputerUseOverlayGuard {
  if (send === undefined) {
    return {
      withCapture: run => run({ excludeWindowIds: [] }),
      withInput: run => run(),
    }
  }
  return {
    withCapture: (run, signal) => withCaptureMode(send, run, signal),
    withInput: (run, signal) => withInputMode(send, run, signal),
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
  } satisfies ComputerUseOverlayGuard)
}
