/**
 * Model-JSON validation for `wait` and `long_wait` durations.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/wait-args
 */

/** Fixed pause for `wait`, in seconds. */
export const WAIT_SECONDS = 1

/** Allowed `long_wait` pauses, in seconds. */
export const LONG_WAIT_SECONDS = [10, 30, 60, 120] as const

/** One allowed `long_wait` pause. */
export type LongWaitSeconds = (typeof LONG_WAIT_SECONDS)[number]

/**
 * Require a `long_wait` duration from model JSON.
 * @param raw - `wait_seconds` from the tool call.
 * @returns one of {@link LONG_WAIT_SECONDS}.
 * @throws when the value is missing or not 10, 30, 60, or 120.
 */
export function requireLongWaitSeconds(raw: unknown): LongWaitSeconds {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || !isLongWaitSeconds(raw)) {
    throw new Error('wait_seconds must be 10, 30, 60, or 120')
  }
  return raw
}

function isLongWaitSeconds(value: number): value is LongWaitSeconds {
  return (LONG_WAIT_SECONDS as readonly number[]).includes(value)
}
