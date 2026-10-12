/**
 * Process-global mutex for screen-controlling GUI actions.
 *
 * Every Computer Use session joins the same standing mount, but the screen, mouse, and keyboard are
 * process-wide resources: two sessions holding turns at once (a chat abandoned by `newSession` or a
 * history switch, woken again by a `code_agent` completion notice; the main window) would interleave
 * HID actions. The lock state lives on `globalThis` under a `Symbol.for` key so every copy of this
 * module in the process shares one lock.
 *
 * Contention fails fast instead of queueing: a queued action would move the user's mouse long after
 * the session lost the spotlight. The thrown error reaches the model as an isError tool result, so
 * it can tell the user and stand down.
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/gui-lock
 */

/** Tool-visible failure text. dsh-tools converts a thrown error into an isError result. */
export const SCREEN_BUSY_MESSAGE =
  'Another Computer Use session is operating the screen. '
  + 'Do not retry GUI actions now; tell the user about the conflict and continue with non-GUI work or end the turn.'

interface ScreenLockState {
  /** Whether any session currently holds the lock. */
  held: boolean
  /** Owner key: the agent id, or a per-call sentinel when the caller carried no id. */
  owner: unknown
}

const SCREEN_LOCK = Symbol.for('dsh-computer-use.screen-lock')

/** Current lock state; exported so tests can observe the hold around a clipboard write. */
export function screenLockState(): ScreenLockState {
  const holder = globalThis as { [SCREEN_LOCK]?: ScreenLockState }
  const existing = holder[SCREEN_LOCK]
  if (existing !== undefined) return existing
  const created: ScreenLockState = { held: false, owner: undefined }
  holder[SCREEN_LOCK] = created
  return created
}

/**
 * Run one screen-controlling action under the global GUI lock.
 * @param owner - calling agent id (`exec.agent?.id`); a caller without an id gets a per-call
 *   sentinel, so unidentified callers still cannot interleave with anyone.
 * @param run - HID or activation plus its recapture.
 * @returns the value `run` resolves to.
 * @throws {@link SCREEN_BUSY_MESSAGE} error when another session holds the lock.
 */
export async function withScreenLock<T>(owner: string | undefined, run: () => Promise<T>): Promise<T> {
  const state = screenLockState()
  const key = owner ?? Symbol('dsh-computer-use.screen-lock.anonymous')
  if (state.held && state.owner !== key) throw new Error(SCREEN_BUSY_MESSAGE)
  // Same-owner re-entry passes through: per-session HID tools are already exclusive, so this only
  // guards against accidental nesting, and the outermost frame owns the release.
  const nested = state.held
  if (!nested) {
    state.held = true
    state.owner = key
  }
  try {
    return await run()
  } finally {
    if (!nested) {
      state.held = false
      state.owner = undefined
    }
  }
}
