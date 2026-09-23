/**
 * Shared observation size limits for macOS points and Windows physical pixels.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/observation-limits
 */

/** Smallest edge that can own an observation. Points on macOS, physical pixels on Windows. */
export const MIN_LAYER0_WINDOW_EDGE = 64

/**
 * Extra units around the owner when a transient is not in its owner chain.
 * Points on macOS, physical pixels on Windows.
 */
export const CROSS_PID_TRANSIENT_PAD = 48
